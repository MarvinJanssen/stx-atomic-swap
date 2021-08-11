const crypto = require('crypto');

function generate_secret(length)
	{
	return new Promise((resolve,reject) => crypto.randomBytes(length || 64,(err,buff) => (err && reject(err)) || resolve(buff)));
	}

function calculate_hash(secret)
	{
	// return Buffer.from(Web3.utils.keccak256(secret).substr(2),'hex');
	return crypto.createHash('sha256').update(secret).digest();
	}

function buffer_to_hex(buffer)
	{
	if (buffer instanceof Buffer)
		return '0x' + buffer.toString('hex');
	else if (buffer.substr(0,2) === '0x')
		return buffer;
	throw new Error(`buffer should be of type Buffer or a 0x prefixed hex string`);
	}

module.exports = {
	generate_secret,
	calculate_hash,
	buffer_to_hex
};