const EthHTLC = artifacts.require('EthHTLC');

const {
	generate_secret,
	calculate_hash,
	assert_is_rejected,
	balance,
	block_height,
	mine_blocks,
	wei} = require('./util');

contract('EthHTLC',accounts =>
	{
	const get_contract = async () =>
		{
		return await EthHTLC.deployed();
		};

	it('Can register swap intent',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		const value = wei('1.1');
		const contract_starting_balance = await balance(eth_htlc.address);
		assert.isOk(await eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value}));
		assert.isTrue((await balance(eth_htlc.address)).sub(contract_starting_balance).eq(value));
		});

	it('Cannot register swap intent with 0 value',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		const value = '0';
		return assert_is_rejected(
			eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value}),
			/No value/,
			'Should have rejected'
			);
		});

	it('Expiration height cannot be in the past',async () =>
		{
		await mine_blocks(5);
		const eth_htlc = await get_contract();
		const [, sender, recipient] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(-1);
		const value = wei('1.23');
		return assert_is_rejected(
			eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value}),
			/Expiry in the past/,
			'Should have rejected'
			);
		});

	it('Swap intent cannot already exist',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		const value = wei('0.98')
		await eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value})
		return assert_is_rejected(
			eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value}),
			/Swap intent already exists/,
			'Should have rejected'
			);
		});

	it('Sender can cancel a swap intent after expiry',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 10;
		const expiration_height = await block_height(blocks);
		const value = wei('1.3');
		await eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value});
		await mine_blocks(blocks);
		const sender_starting_balance = await balance(sender);
		const cancellation = await eth_htlc.cancel_swap_intent(hash, {from: sender});
		assert.isOk(cancellation);
		assert.isTrue((await balance(sender)).gt(sender_starting_balance));
		});

	it('Sender cannot cancel a swap intent before expiry',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 10;
		const expiration_height = await block_height(blocks);
		const value = wei('1.09')
		await eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value});
		return assert_is_rejected(
			eth_htlc.cancel_swap_intent(hash, {from: sender}),
			/Swap intent not expired/,
			'Should have rejected'
			);
		});

	it('Sender cannot cancel a swap intent that does not exist',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		return assert_is_rejected(
			eth_htlc.cancel_swap_intent(hash, {from: sender}),
			/Unknown swap/,
			'Should have rejected'
			);
		});

	it('Third party cannot cancel a swap intent after expiry',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient, third_party] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 10;
		const expiration_height = await block_height(blocks);
		const value = wei('1.5');
		await eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value});
		await mine_blocks(blocks);
		return assert_is_rejected(
			eth_htlc.cancel_swap_intent(hash, {from: third_party}),
			/Unknown swap/,
			'Should have rejected'
			);
		});

	it('Anyone can trigger swap before expiry using the correct preimage',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient, third_party] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		const value = wei('0.87')
		await eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value});
		assert.isOk(eth_htlc.swap(sender, secret, {from: third_party}));
		});

	it('Nobody can trigger swap after expiry using the correct preimage',async () =>
		{
		const eth_htlc = await get_contract();
		const [, sender, recipient, third_party] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 12;
		const expiration_height = await block_height(blocks);
		const value = wei('0.03');
		await eth_htlc.register_swap_intent(hash, expiration_height, recipient, {from: sender, value});
		await mine_blocks(blocks);
		return assert_is_rejected(
			eth_htlc.swap(sender, secret, {from: third_party}),
			/Swap intent expired/,
			'Should have rejected'
			);
		});
	});
