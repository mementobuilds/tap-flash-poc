#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, '..', '.state', 'agent-insights-state.json');
fs.rmSync(statePath, { force: true });
console.log(`Removed ${statePath}`);
