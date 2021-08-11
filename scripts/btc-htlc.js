#!/usr/bin/env node
if (process.argv.length !== 6)
	{
	console.log('Usage: btc-htlc.js preimage expiration-height sender-pubkey recipient-pubkey');
	process.exit(0);
	}
const crypto = require('crypto');
const {btc_generate_htlc} = require('../test/util');
const [,,preimage,expiration_height,sender_pubkey,recipient_pubkey] = process.argv;
const hash = crypto.createHash('sha256').update(preimage).digest('hex');
const script = btc_generate_htlc(hash, sender_pubkey, recipient_pubkey, parseInt(expiration_height));
console.log(script.toString('hex'));
