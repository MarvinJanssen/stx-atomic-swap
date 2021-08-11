#!/usr/bin/env node
const web3 = require('web3');
const input = process.argv[2];
process.argv[2] && console.log(web3.utils.keccak256(input));
