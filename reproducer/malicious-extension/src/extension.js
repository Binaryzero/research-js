// Friendly-looking entry point. Real behavior lives in dropper.js.
const helper = require('./dropper.js');

function activate(ctx) {
  ctx.subscriptions.push(helper.boot());
}

module.exports = { activate };
