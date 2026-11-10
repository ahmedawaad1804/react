'use strict';

// Timed work includes element creation, reconciliation and synchronous commit.
// verify() checks every row outside the timed interval, including its order.
async function measure(React, createRoot, scenario) {
  const {size, gap, iterable, reorder} = scenario;
  const ids = Array.from({length: size}, (_, i) => 'row-' + i);
  const expectedIds = ids.filter((_, i) => !gap || i !== 1);
  const adapter = createRoot();
  const batchSize = size === 1000 ? 48 : 5;
  const warmups = size === 1000 ? 50 : 15;
  let revision = 0;

  function Row({id, revision}) {
    return React.createElement('span', null, id + ':' + revision);
  }
  function idAt(index, names) {
    if (reorder && revision % 2 === 1 && index < 2) return names[1 - index];
    return names[index];
  }
  function update() {
    revision++;
    const values = ids.map((_, i) => {
      if (gap && i === 1) return null;
      const id = idAt(i, ids);
      return React.createElement(Row, {key: id, id, revision});
    });
    const children = iterable
      ? {[Symbol.iterator]: () => values[Symbol.iterator]()}
      : values;
    adapter.render(React.createElement('main', null, children));
  }
  function verify() {
    const received = adapter.read();
    if (
      received.length !== expectedIds.length ||
      expectedIds.some(
        (_, i) => received[i] !== idAt(i, expectedIds) + ':' + revision,
      )
    ) {
      throw new Error(
        'Incorrect committed output for ' +
          JSON.stringify(scenario) +
          ', revision ' +
          revision,
      );
    }
  }
  try {
    update();
    verify();
    for (let i = 0; i < warmups; i++) update();
    verify();
    const batchMs = [];
    for (let sample = 0; sample < 18; sample++) {
      const start = performance.now();
      for (let i = 0; i < batchSize; i++) update();
      batchMs.push(performance.now() - start);
      verify();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      ...scenario,
      rows: expectedIds.length,
      batchSize,
      batchMs,
      verifiedRevision: revision,
    };
  } finally {
    adapter.dispose();
  }
}
module.exports = measure;
