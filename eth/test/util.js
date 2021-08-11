const crypto = require('crypto');
const BN = require('bn.js');

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

const required_swap_fields = ["intent_hash","expiration_height","recipient"];

function generate_secret(length)
	{
	return new Promise((resolve,reject) => crypto.randomBytes(length || 64,(err,buff) => (err && reject(err)) || resolve(buff)));
	}

function calculate_hash(secret)
	{
	return crypto.createHash('sha256').update(secret).digest();
	}

// Truffle does not expose chai so it is impossible to add chai-as-promised.
// This is a simple replacement function.
// https://github.com/trufflesuite/truffle/issues/2090
function assert_is_rejected(promise,error_match,message)
	{
	return promise.then(
		() => assert.fail(message || 'Expected promise to be rejected'),
		error =>
			{
			if (error_match)
				{
				if (typeof error_match === 'string')
					return assert.equal(error_match,error.message,message);
				if (error_match instanceof RegExp)
					return error.message.match(error_match) || assert.fail(error.message,error_match.toString(),`'${error.message}' does not match ${error_match.toString()}: ${message}`);
				return assert.instanceOf(error,error_match,message);
				}
			}
		)
	}

async function balance(address)
	{
	return new BN(await web3.eth.getBalance(address));
	}

async function block_height(increment)
	{
	const height = new BN(await web3.eth.getBlockNumber());
	return increment ? height.add(new BN(increment)) : height;
	}

async function mine_empty_block()
	{
	return new Promise((resolve,reject) => 
		web3.currentProvider.send(
			{
			jsonrpc: '2.0',
			method: 'evm_mine',
			id: +new Date()
			},
			(err, result) => err ? reject(err) : resolve(result))
		);
	}

async function mine_blocks(n)
	{
	let blocks = [];
	if (n.toNumber)
		n = n.toNumber();
	for (let i = 0 ; i < n ; ++i)
		blocks.push(mine_empty_block());
	return Promise.all(blocks);
	}

function wei(ether)
	{
	return new BN(web3.utils.toWei(ether));
	}

module.exports = {
	NULL_ADDRESS,
	generate_secret,
	calculate_hash,
	assert_is_rejected,
	balance,
	block_height,
	mine_blocks,
	wei
};
