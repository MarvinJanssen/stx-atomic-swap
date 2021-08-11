const spawn = require('child_process').spawn;
const BitcoinClient = require('bitcoin-core');
const bitcoin = require('bitcoinjs-lib');
const bip65 = require('bip65');
const fs = require('fs/promises');
const crypto = require('crypto');
const BN = require('bn.js');
var net = require('net');

const DEBUG = !!process.env.DEBUG;

async function local_port_open(port)
	{
	return new Promise(resolve =>
		{
		let socket;
		const timeout = setTimeout(() => {socket.end();resolve(false);},10000);
		socket = net.createConnection(port,'127.0.0.1',() => {socket.end();clearTimeout(timeout);resolve(true);});
		socket.on('error',() => {clearTimeout(timeout);resolve(false);});
		});
	}

async function wait_btc_client()
	{
	return new Promise((resolve,reject) =>
		{
		const port = 18332;
		let attempts = 0;
		let try_client = async () =>
			{
			++attempts;
			if (await local_port_open(port))
				return setTimeout(() => resolve(new BitcoinClient({network: 'regtest', port, username: 'stxswap', password: 'stxswappassword'})),1000); // needs some time to load block index, we should query instead of setting a timer.
			if (attempts > 40) // 10 sec
				return reject("BTC RPC not responding after 10 seconds");
			setTimeout(try_client,250);
			}
		try_client();
		});
	}

async function start_btc_chain()
	{
	return new Promise(async (resolve,reject) =>
		{
		const regtest_directory = './btc/regtest';
		await fs.rm(regtest_directory,{recursive: true, force: true});
		const child = spawn('npm run btc-test-rpc',{shell: true});
		DEBUG && child.stdout.on('data',chunk => console.debug(chunk.toString()));
		child.on('error',reject);
		child.on('exit',code => code > 0 && reject(`BTC process exited with ${code}. Set DEBUG=1 for more information.`));
		const client = await wait_btc_client();
		await client.createWallet('test');
		await client.setTxFee('0.00001');
		const addresses = await Promise.all([client.getNewAddress(),client.getNewAddress(),client.getNewAddress()]);
		const private_keys = await Promise.all(addresses.map(address => client.dumpPrivKey(address)));
		const accounts = private_keys.map(private_key => bitcoin.ECPair.fromWIF(private_key, bitcoin.networks.regtest));
		accounts.map((account,index) => account.address = addresses[index]);
		await client.generateToAddress(101, accounts[0].address); // mine 101 blocks so we have 50 BTC of mature balance.
		await Promise.all(accounts.slice(1).map(account => client.sendToAddress(account.address, '10'))); // send 10 BTC to the other addresses
		resolve({
			child,
			client,
			session: {accounts},
			mine_empty_blocks: async function(count)
				{
				return client.generateToAddress(count, accounts[0].address);
				},
			block_height: async (increment) =>
				{
				const height = new BN(await client.getBlockCount());
				return increment ? height.add(new BN(increment)) : height;
				},
			balance: async function(address, confirmations)
				{
				return client.getReceivedByAddress(address, confirmations || 0);
				},
			kill: function(signal)
				{
				this.child.kill(signal);
				fs.rm(regtest_directory,{recursive: true, force: true});
				}
			});
		});
	}

function btc_to_sat(n)
	{
	return (new BN(n)).mul(new BN('100000000'));
	}

function btc_generate_htlc(hash, sender_public_key, recipient_public_key, expiration_height)
	{
	const script = bitcoin.script.fromASM(`
	OP_SHA256 ${hash.toString('hex')}
	OP_EQUAL
	OP_IF
		${recipient_public_key.toString('hex')}
	OP_ELSE
		${bitcoin.script.number.encode(bip65.encode({blocks: expiration_height})).toString('hex')}
		OP_CHECKLOCKTIMEVERIFY
		OP_DROP
		${sender_public_key.toString('hex')}
	OP_ENDIF
	OP_CHECKSIG`.replace(/\s+/g,' ').trim());
	return script;
	}

function btc_htlc_scriptpubkey(script)
	{
	const script_buffer = typeof script === 'string' ? Buffer.from(script,'hex') : script;
	return Buffer.concat([Buffer.from('0020', 'hex'),crypto.createHash('sha256').update(script_buffer).digest()]);
	}

async function btc_register_swap_intent(options)
	{
	const {
		btc_chain, // object, BTC chain instance from start_btc_chain()
		sender, // ECPair
		recipient_public_key,
		hash,
		amount,
		expiration_height,
		network,
		tx_fee_sat // tx fee in sat to add
		} = options;
	if (!btc_chain || !sender || !sender.publicKey || !recipient_public_key || !hash || !amount || !expiration_height)
		throw new Error(`Missing options`);
	const net = typeof network === 'string' ? bitcoin.networks[network || 'regtest'] : network;
	const htlc = btc_generate_htlc(hash, sender.publicKey, recipient_public_key, expiration_height);
	const p2wsh = bitcoin.payments.p2wsh({redeem: {output: htlc, network: net}, network: net});
	const total_btc = (amount + (tx_fee_sat / 100000000)).toFixed(8);
	const htlc_txid = await btc_chain.client.sendToAddress(p2wsh.address, total_btc); //TODO- sent from sender_private_key
	const tx = await btc_chain.client.getTransaction(htlc_txid);
	return {
		htlc,
		htlc_address: p2wsh.address,
		htlc_txid,
		vout: tx.details[0].vout,
		network,
		amount,
		htlc_tx_fee_sat: tx_fee_sat,
		expiration_height
		};
	}

// lifted from bitcoinjs-lib/src/psbt.js
const varuint = require('bip174/src/lib/converter/varint');
function witnessStackToScriptWitness(witness) {
	let buffer = Buffer.allocUnsafe(0);
	function writeSlice(slice) {
		buffer = Buffer.concat([buffer, Buffer.from(slice)]);
	}
	function writeVarInt(i) {
		const currentLen = buffer.length;
		const varintLen = varuint.encodingLength(i);
		buffer = Buffer.concat([buffer, Buffer.allocUnsafe(varintLen)]);
		varuint.encode(i, buffer, currentLen);
	}
	function writeVarSlice(slice) {
		writeVarInt(slice.length);
		writeSlice(slice);
	}
	function writeVector(vector) {
		writeVarInt(vector.length);
		vector.forEach(writeVarSlice);
	}
	writeVector(witness);
	return buffer;
	}

function btc_build_htlc_redeem_transaction(options)
	{
	const {
		preimage, // buff
		htlc,
		htlc_txid,
		vout,
		network,
		amount,
		htlc_tx_fee_sat,
		expiration_height,
		recipient,
		refund
		} = options;
	if (!preimage || !htlc || !amount || !expiration_height || !recipient || !recipient.publicKey)
		throw new Error('Missing options');
	const net = typeof network === 'string' ? bitcoin.networks[network || 'regtest'] : network;
	const psbt = new bitcoin.Psbt({network: net});
	const amount_sat = new BN(Math.round(amount * 100000000));
	const total_sat = amount_sat.add(new BN(htlc_tx_fee_sat || '200'));
	if (refund)
		psbt.setLocktime(bip65.encode({blocks: expiration_height}));
	psbt.addInput({
		hash: htlc_txid,
		index: vout,
		sequence: 0xfffffffe, //UINT_MAX - 1
		witnessUtxo: {
			script: btc_htlc_scriptpubkey(htlc),
			value: total_sat.toNumber()
			},
		witnessScript: htlc
		});
	psbt.addOutput({
		address: recipient.address,
		value: amount_sat.toNumber()
		});
	psbt.signInput(0, recipient);
	psbt.finalizeInput(0, (index, input, script) =>
		{
		//console.log(script.toString('hex'));
		const claim_branch = bitcoin.payments.p2wsh({
			redeem: {
				input: bitcoin.script.compile([input.partialSig[0].signature,refund ? Buffer.from([]) : preimage]),
				output: htlc,
				}
			});
		return {
			finalScriptWitness: witnessStackToScriptWitness(claim_branch.witness)
			};
		});
	return psbt.extractTransaction();
	}

async function btc_execute_swap(options)
	{
	const {
		btc_chain,
		preimage, // buff
		recipient
		} = options;
	if (!preimage || !recipient || !recipient.publicKey)
		throw new Error('Missing options');
	const tx = btc_build_htlc_redeem_transaction({...options, refund: false});
	return btc_chain.client.sendRawTransaction(tx.toHex());
	}

async function btc_refund_swap_intent(options)
	{
	const {
		btc_chain,
		preimage, // buff
		recipient
		} = options;
	if (!preimage || !recipient || !recipient.publicKey)
		throw new Error('Missing options');
	const tx = btc_build_htlc_redeem_transaction({...options, refund: true});
	return btc_chain.client.sendRawTransaction(tx.toHex());
	}

module.exports = {
	start_btc_chain,
	btc_generate_htlc,
	btc_register_swap_intent,
	btc_build_htlc_redeem_transaction,
	btc_execute_swap,
	btc_refund_swap_intent
};
	