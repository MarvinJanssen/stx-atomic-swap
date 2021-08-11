#!/usr/bin/env node
const crypto = require('crypto');
const input = process.argv[2];
process.argv[2] && console.log('0x'+crypto.createHash('sha256').update(input).digest('hex'));
