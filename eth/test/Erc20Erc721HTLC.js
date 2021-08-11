const Erc20Erc721HTLC = artifacts.require('Erc20Erc721HTLC');
const TestERC20 = artifacts.require('TestERC20');
const TestERC721 = artifacts.require('TestERC721');

const {
	generate_secret,
	calculate_hash,
	assert_is_rejected,
	block_height,
	mine_blocks} = require('./util');

const MAX_INT = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

contract('Erc20Erc721HTLC',accounts =>
	{
	let htlc_approved = false;

	const deployed = async (list) => Promise.all(list.map(list => list.deployed()));

	const get_contracts = async () =>
		{
		const [erc20_erc721_htlc,erc20,erc721] = await deployed([Erc20Erc721HTLC,TestERC20,TestERC721]);
		return {erc20_erc721_htlc,erc20,erc721};
		};

	const prepare_basic_test = async (options) =>
		{
		const {sender, erc20_amount} = options;
		const {erc20_erc721_htlc, erc20, erc721} = await get_contracts();
		const amount = erc20_amount || (~~(Math.random()*5000) + 2000);
		const result = await Promise.all(
			[
				erc721.mint(sender),
				erc20.mint(sender, amount),
				htlc_approved || erc721.setApprovalForAll(erc20_erc721_htlc.address,true,{from: sender}),
				htlc_approved || erc20.approve(erc20_erc721_htlc.address,MAX_INT,{from: sender})
			]);
		htlc_approved = true;
		const erc721_token_id = result[0].receipt.logs[0].args.tokenId.toNumber();
		return {erc20_erc721_htlc, erc20, erc721, erc721_token_id, erc20_amount: amount};
		};

	it('ERC20: can register swap intent',async () =>
		{
		const [, sender, recipient] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		const contract_starting_balance = (await erc20.balanceOf(erc20_erc721_htlc.address)).toNumber();
		assert.isOk(await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender}));
		assert.equal((await erc20.balanceOf(erc20_erc721_htlc.address)).toNumber() - contract_starting_balance, erc20_amount);
		});
	
	it('ERC20: sender can cancel a swap intent after expiry',async () =>
		{
		const [, sender, recipient] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 10;
		const expiration_height = await block_height(blocks);
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender});
		await mine_blocks(blocks);
		const sender_starting_balance = (await erc20.balanceOf(sender)).toNumber();
		const cancellation = await erc20_erc721_htlc.cancel_swap_intent(hash, {from: sender});
		assert.isOk(cancellation);
		assert.equal((await erc20.balanceOf(sender)).toNumber() - sender_starting_balance, erc20_amount);
		});

	it('ERC20: anyone can trigger swap before expiry using the correct preimage',async () =>
		{
		const [, sender, recipient, third_party] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		const recipient_starting_balance = (await erc20.balanceOf(recipient)).toNumber();
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender});
		assert.isOk(await erc20_erc721_htlc.swap(sender, secret, {from: third_party}));
		assert.equal((await erc20.balanceOf(recipient)).toNumber() - recipient_starting_balance, erc20_amount);
		});

	it('ERC721: can register swap intent',async () =>
		{
		const [, sender, recipient] = accounts;
		const {erc20_erc721_htlc, erc721, erc721_token_id} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		assert.isOk(await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc721.address, erc721_token_id, {from: sender}));
		assert.equal(await erc721.ownerOf(erc721_token_id), erc20_erc721_htlc.address);
		});

	it('ERC721: sender can cancel a swap intent after expiry',async () =>
		{
		const [, sender, recipient] = accounts;
		const {erc20_erc721_htlc, erc721, erc721_token_id} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 12;
		const expiration_height = await block_height(blocks);
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc721.address, erc721_token_id, {from: sender});
		assert.equal(await erc721.ownerOf(erc721_token_id), erc20_erc721_htlc.address);
		await mine_blocks(blocks);
		const cancellation = await erc20_erc721_htlc.cancel_swap_intent(hash, {from: sender});
		assert.isOk(cancellation);
		assert.equal(await erc721.ownerOf(erc721_token_id), sender);
		});

	it('ERC721: anyone can trigger swap before expiry using the correct preimage',async () =>
		{
		const [, sender, recipient, third_party] = accounts;
		const {erc20_erc721_htlc, erc721, erc721_token_id} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc721.address, erc721_token_id, {from: sender});
		assert.equal(await erc721.ownerOf(erc721_token_id), erc20_erc721_htlc.address);
		await erc20_erc721_htlc.swap(sender, secret, {from: third_party});
		assert.equal(await erc721.ownerOf(erc721_token_id), recipient);
		});

	it('ERC20/ERC721: expiration height cannot be in the past',async () =>
		{
		await mine_blocks(5);
		const [, sender, recipient] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(-1);
		return assert_is_rejected(
			erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender}),
			/Expiry in the past/,
			'Should have rejected'
			);
		});

	it('ERC20/ERC721: swap intent cannot already exist',async () =>
		{
		const [, sender, recipient] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender});
		return assert_is_rejected(
			erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender}),
			/Swap intent already exists/,
			'Should have rejected'
			);
		});

	it('ERC20/ERC721: sender cannot cancel a swap intent before expiry',async () =>
		{
		const [, sender, recipient] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const expiration_height = await block_height(10);
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender});
		return assert_is_rejected(
			erc20_erc721_htlc.cancel_swap_intent(hash, {from: sender}),
			/Swap intent not expired/,
			'Should have rejected'
			);
		});

	it('ERC20/ERC721: sender cannot cancel a swap intent that does not exist',async () =>
		{
		const [erc20_erc721_htlc] = await deployed([Erc20Erc721HTLC]);
		const [, sender] = accounts;
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		return assert_is_rejected(
			erc20_erc721_htlc.cancel_swap_intent(hash, {from: sender}),
			/Unknown swap/,
			'Should have rejected'
			);
		});

	it('ERC20/ERC721: third party cannot cancel a swap intent after expiry',async () =>
		{
		const [, sender, recipient, third_party] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 10;
		const expiration_height = await block_height(blocks);
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender});
		await mine_blocks(blocks);
		return assert_is_rejected(
			erc20_erc721_htlc.cancel_swap_intent(hash, {from: third_party}),
			/Unknown swap/,
			'Should have rejected'
			);
		});

	it('ERC20/ERC721: nobody can trigger swap after expiry using the correct preimage',async () =>
		{
		const [, sender, recipient, third_party] = accounts;
		const {erc20_erc721_htlc, erc20, erc20_amount} = await prepare_basic_test({sender});
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const blocks = 16;
		const expiration_height = await block_height(blocks);
		await erc20_erc721_htlc.register_swap_intent(hash, expiration_height, recipient, erc20.address, erc20_amount, {from: sender});
		await mine_blocks(blocks);
		return assert_is_rejected(
			erc20_erc721_htlc.swap(sender, secret, {from: third_party}),
			/Swap intent expired/,
			'Should have rejected'
			);
		});
	});
