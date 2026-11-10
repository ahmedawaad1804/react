'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const measure = require('./fixture.cjs');
const fixture = require.resolve('./fixture.cjs');

const scenarios = [
  {size: 1000, gap: true, iterable: false},
  {size: 1000, gap: false, iterable: false},
  {size: 10000, gap: true, iterable: false},
  {size: 10000, gap: false, iterable: false},
  {size: 1000, gap: true, iterable: true},
  {size: 1000, gap: false, iterable: true},
  {size: 1000, gap: false, iterable: false, reorder: true},
];

function packageRequire(modules) {
  return createRequire(path.join(path.resolve(modules), 'probe.cjs'));
}

async function runNoop(modules, orderedScenarios) {
  const req = packageRequire(modules);
  const React = req('react');
  const Noop = req('react-noop-renderer');
  function createRoot() {
    const root = Noop.createRoot({
      onUncaughtError(error) {
        throw error;
      },
    });
    return {
      render: (tree) => Noop.flushSync(() => root.render(tree)),
      read: () =>
        root.getChildrenAsJSX().props.children.map((row) => row.props.children),
      dispose: () => Noop.flushSync(() => root.render(null)),
    };
  }
  const results = [];
  for (const scenario of orderedScenarios)
    results.push(await measure(React, createRoot, scenario));
  return results;
}

async function domBundle(modules) {
  const {build} = require('esbuild');
  const req = packageRequire(modules);
  const {outputFiles} = await build({
    stdin: {
      contents: `
      const React = require(${JSON.stringify(req.resolve('react'))});
      const {createRoot} = require(${JSON.stringify(req.resolve('react-dom/client'))});
      const {flushSync} = require(${JSON.stringify(req.resolve('react-dom'))});
      const measure = require(${JSON.stringify(fixture)});
      function createDOMRoot() {
        const container = document.body.appendChild(document.createElement('div'));
        const root = createRoot(container, {onUncaughtError(error) { throw error; }});
        return {
          render: tree => flushSync(() => root.render(tree)),
          read: () => Array.from(container.firstChild.children, row => row.textContent),
          dispose() {flushSync(() => root.unmount()); container.remove();},
        };
      }
      globalThis.runScenarios = async scenarios => {
        const results = [];
        for (const scenario of scenarios) results.push(await measure(React, createDOMRoot, scenario));
        return results;
      };
    `,
      resolveDir: __dirname,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    define: {'process.env.NODE_ENV': '"production"'},
  });
  return outputFiles[0].text;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
function id(scenario) {
  return [
    scenario.iterable ? 'iterable' : 'array',
    scenario.size,
    scenario.reorder ? 'swap-first-two' : scenario.gap ? 'gap' : 'dense',
  ].join('/');
}
function summarize(runs, renderers) {
  const summary = [];
  for (const renderer of renderers) {
    const selected = runs.filter((run) => run.renderer === renderer);
    for (const scenario of scenarios) {
      const get = (variant) =>
        selected
          .filter((run) => run.variant === variant)
          .map((run) => {
            const row = run.results.find(
              (result) => id(result) === id(scenario),
            );
            return median(row.batchMs) / row.batchSize;
          });
      const baseline = get('baseline');
      const patched = get('patched');
      const changes = baseline.map(
        (time, i) => (100 * (time - patched[i])) / time,
      );
      summary.push({
        renderer,
        case: id(scenario),
        baselineMs: median(baseline),
        patchedMs: median(patched),
        pairedReductionPct: median(changes),
        fasterPairs: changes.filter((value) => value > 0).length,
        totalPairs: changes.length,
      });
    }
  }
  return summary;
}

async function main() {
  if (process.argv[2] === '--noop-worker') {
    const results = await runNoop(process.argv[3], JSON.parse(process.argv[4]));
    process.stdout.write(JSON.stringify(results));
    return;
  }
  const [base, patch, output, pairsArg = '12'] = process.argv.slice(2);
  if (!output)
    throw new Error(
      'Usage: node run.cjs BASE_NODE_MODULES PATCH_NODE_MODULES OUTPUT.json [EVEN_PAIRS]',
    );
  const pairs = Number(pairsArg);
  if (pairs < 2 || !Number.isSafeInteger(pairs) || pairs % 2 !== 0)
    throw new Error('Use a positive even pair count.');
  const modules = {baseline: path.resolve(base), patched: path.resolve(patch)};
  const bundles = {};
  const checksums = {};
  for (const [variant, directory] of Object.entries(modules)) {
    const hash = (data) =>
      crypto.createHash('sha256').update(data).digest('hex');
    bundles[variant] = await domBundle(directory);
    checksums[variant] = {
      domBundle: hash(bundles[variant]),
      domClient: hash(
        fs.readFileSync(
          path.join(directory, 'react-dom/cjs/react-dom-client.production.js'),
        ),
      ),
      reconciler: hash(
        fs.readFileSync(
          path.join(
            directory,
            'react-reconciler/cjs/react-reconciler.production.js',
          ),
        ),
      ),
    };
  }
  if (
    checksums.baseline.domClient === checksums.patched.domClient ||
    checksums.baseline.reconciler === checksums.patched.reconciler
  )
    throw new Error('Expected distinct production builds.');
  const {chromium} = require('playwright');
  const renderers = ['dom', 'noop'];
  const data = {
    startedAt: new Date(),
    node: process.version,
    v8: process.versions.v8,
    cpu: os.cpus()[0].model,
    platform: process.platform,
    arch: process.arch,
    browser: null,
    pairs,
    checksums,
    runs: [],
  };
  for (const renderer of renderers) {
    for (let pair = 0; pair < pairs; pair++) {
      const order =
        pair % 2 === 0 ? ['baseline', 'patched'] : ['patched', 'baseline'];
      const start = pair % scenarios.length;
      const ordered = scenarios.slice(start).concat(scenarios.slice(0, start));
      for (const variant of order) {
        console.log(renderer, 'pair', pair + 1, variant);
        let results;
        if (renderer === 'dom') {
          const browser = await chromium.launch({headless: true});
          try {
            data.browser = browser.version();
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(String(error)));
            await page.addScriptTag({content: bundles[variant]});
            results = await page.evaluate(
              (inputs) => globalThis.runScenarios(inputs),
              ordered,
            );
            if (errors.length) throw new Error(errors.join('\n'));
          } finally {
            await browser.close();
          }
        } else {
          const result = spawnSync(
            process.execPath,
            [
              __filename,
              '--noop-worker',
              modules[variant],
              JSON.stringify(ordered),
            ],
            {encoding: 'utf8', env: {...process.env, NODE_ENV: 'production'}},
          );
          if (result.status !== 0 || result.error)
            throw (
              result.error ||
              new Error(result.stderr || `Worker exit ${result.status}`)
            );
          results = JSON.parse(result.stdout);
        }
        data.runs.push({renderer, pair, variant, results});
        fs.writeFileSync(output + '.partial', JSON.stringify(data));
      }
    }
  }
  data.summary = summarize(data.runs, renderers);
  data.finishedAt = new Date();
  fs.writeFileSync(output + '.partial', JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(output + '.partial', output);
  console.table(data.summary);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
