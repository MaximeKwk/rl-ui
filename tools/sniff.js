#!/usr/bin/env node
'use strict';
// Enregistre le flux brut de la Stats API (diagnostic) : node tools/sniff.js [secondes] [fichier.jsonl] [port]
// Lecture seule : ne fait qu'écouter ce que le jeu diffuse.

const net = require('net');
const fs = require('fs');
const { JsonFramer, decodeEnvelope } = require('../core/jsonFramer');

const secs = Number(process.argv[2]) || 60;
const out = process.argv[3] || 'statsapi-sniff.jsonl';
const port = Number(process.argv[4]) || 49123;
const framer = new JsonFramer();
const counts = {};
let first = true;
const stream = fs.createWriteStream(out);

const sock = net.connect({ host: '127.0.0.1', port }, () => console.log(`connecté au port ${port}, écoute ${secs} s…`));
sock.on('data', (chunk) => {
  if (first) {
    first = false;
    stream.write(JSON.stringify({ _rawStart: chunk.toString('utf8', 0, Math.min(chunk.length, 300)) }) + '\n');
  }
  for (const raw of framer.push(chunk)) {
    const obj = JSON.parse(raw);
    const env = decodeEnvelope(obj);
    if (!env) continue;
    counts[env.event] = (counts[env.event] || 0) + 1;
    stream.write(JSON.stringify({ t: Date.now(), event: env.event, dataType: typeof obj.Data, data: env.data }) + '\n');
  }
});
sock.on('error', (e) => {
  console.error('erreur :', e.message);
  process.exit(1);
});
setTimeout(() => {
  console.log('événements :', counts);
  stream.end();
  sock.destroy();
}, secs * 1000);
