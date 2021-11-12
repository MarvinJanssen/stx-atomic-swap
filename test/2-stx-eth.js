const assert = require('chai').assert;
const BN = require('bn.js');

const {
	start_stx_chain,
	start_eth_chain,
	generate_secret,
	calculate_hash,
	uintCV,
	principalCV,
	bufferCV,
	stx_register_swap_intent,
	stx_execute_swap,
	sip009_mint,
	sip009_owner,
	sip010_mint,
	sip010_balance,
	sip009_sip010_htlc_set_whitelisted,
	eth_register_swap_intent,
	eth_execute_swap,
	erc20_mint,
	erc20_approve_htlc,
	erc20_balance,
	erc721_mint,
	erc721_approve_htlc,
	erc721_owner
	} = require('./util');

async function register_swap_intents(hash, stx_options, eth_options)
	{
	const [stx,eth] = await Promise.all([stx_register_swap_intent({...stx_options, hash}), eth_register_swap_intent({...eth_options, hash})]);
	return {stx,eth};
	}

async function execute_swaps(preimage, stx_options, eth_options)
	{
	stx_options = {...stx_options, preimage};
	eth_options = {...eth_options, preimage};
	const [stx,eth] = await Promise.all([stx_execute_swap(stx_options), eth_execute_swap(eth_options)]);
	return {stx,eth};
	}

async function generate_standard_swap_intents(options)
	{
	const {
		party_a_stx_wallet,
		party_b_stx_wallet,
		party_a_eth_wallet,
		party_b_eth_wallet,
		stx_amount_or_token_id,
		eth_amount_or_token_id,
		stx_asset_contract,
		stx_asset_type,
		eth_asset_contract,
		stx_chain,
		eth_chain
		} = options;
	const preimage = await generate_secret();
	const hash = calculate_hash(preimage);
	const stx_expiration = await stx_chain.block_height(100);
	const eth_expiration = await eth_chain.block_height(100);

	const {deployer: deployer_stx} = stx_chain.session.accounts;
	const [deployer_eth] = eth_chain.session.accounts;

	const stx_side = {
		stx_chain,
		sender: (party_a_stx_wallet && party_a_stx_wallet.address) || stx_chain.session.accounts.wallet_1.address,
		recipient: (party_b_stx_wallet && party_b_stx_wallet.address) || stx_chain.session.accounts.wallet_2.address,
		transaction_sender: deployer_stx.address,
		amount_or_token_id: stx_amount_or_token_id,
		asset_contract: stx_asset_contract,
		asset_type: stx_asset_type,
		expiration_height: stx_expiration
	};

	const eth_side = {
		eth_chain,
		sender: party_b_eth_wallet || eth_chain.session.accounts[2],
		recipient: party_a_eth_wallet  || eth_chain.session.accounts[1],
		transaction_sender: deployer_eth,
		amount_or_token_id: eth_amount_or_token_id,
		asset_contract: eth_asset_contract,
		expiration_height: eth_expiration
		};
	
	return {hash, preimage, stx_side, eth_side};
	}

describe('STX <> ETH',async function()
	{
	before(async function() 
		{
		console.debug("Starting STX and ETH chains...");
		console.debug("");
		let stx_chain_process, eth_chain_process;
		const kill = () =>
			{
			console.log('Stopping chains...');
			try {stx_chain_process.kill('SIGINT');} catch(e){};
			try {eth_chain_process.kill('SIGINT');} catch(e){};
			};
		process.on('SIGINT',kill);
		process.on('uncaughtException',kill);
		try
			{
			[stx_chain_process,eth_chain_process] = await Promise.all([start_stx_chain(),start_eth_chain()]);
			}
		catch (error)
			{
			console.error(error);
			kill();
			process.exit(1);
			}
		this.stx = stx_chain_process;
		this.eth = eth_chain_process;
		});

	after(function()
		{
		console.debug("Stopping chains...");
		this.stx.kill();
		this.eth.kill();
		});

	it('Can register swap intent on STX and ETH',async function()
		{
		const preimage = await generate_secret();
		const hash = calculate_hash(preimage);
		const stx_expiration = await this.stx.block_height(10);
		const stx_amount = 100;
		const eth_expiration = await this.eth.block_height(100);
		const eth_amount = 150;

		// STX side
		const {deployer, wallet_1} = this.stx.session.accounts;
		const stx_call = await this.stx.contract_call('.stx-htlc', 'register-swap-intent', [bufferCV(hash), uintCV(stx_expiration), uintCV(stx_amount), principalCV(wallet_1.address)], deployer.address);
		assert.equal(stx_call[0].result, '(ok true)');

		// ETH side
		const [eth_deployer, eth_wallet_1] = this.eth.session.accounts;
		const eth_call = await this.eth.session.contracts.EthHTLC.methods.register_swap_intent(hash, eth_expiration, eth_wallet_1).send({value: eth_amount, from: eth_deployer});
		assert.isTrue(eth_call.status);

		// Check if the swap exists on both chains.
		const stx_swap_intent = await this.stx.read_only_call('.stx-htlc', 'get-swap-intent', [bufferCV(hash), principalCV(deployer.address)]);
		assert.equal(stx_swap_intent.result, `(some {amount: u${stx_amount}, expiration-height: u${stx_expiration}, recipient: ${wallet_1.address}})`);

		const eth_swap_intent = await this.eth.session.contracts.EthHTLC.methods.get_swap_intent(hash, eth_deployer).call();
		assert.equal(eth_swap_intent.expiration_height, eth_expiration);
		assert.equal(eth_swap_intent.amount, eth_amount);
		assert.equal(eth_swap_intent.recipient, eth_wallet_1);
		});

	it('Can swap STX and ETH',async function()
		{
		// Swap:
		// 2000000 mSTX from Party A -> Party B
		// 1500000000 wei ETH from Party B -> Party A

		// I will spell the first one out, the other ones will use helper functions to prepare
		// and trigger the swaps.

		const preimage = await generate_secret();
		const hash = calculate_hash(preimage);
		const stx_amount = new BN(2000000);
		const eth_amount = new BN(1500000000);
		const stx_expiration = await this.stx.block_height(10);
		const eth_expiration = await this.eth.block_height(100);
		const {deployer, wallet_1} = this.stx.session.accounts;
		const [eth_deployer, eth_wallet_1, eth_matcher] = this.eth.session.accounts;

		const party_a = {
			stx_address: deployer.address,
			eth_address: eth_wallet_1
		};

		const party_b = {
			stx_address: wallet_1.address,
			eth_address: eth_deployer
		};

		const party_a_starting_eth_balance = await this.eth.balance(party_a.eth_address);
		const party_b_starting_stx_balance = await this.stx.balance(party_b.stx_address);

		// STX swap intent
		await this.stx.contract_call('.stx-htlc', 'register-swap-intent', [bufferCV(hash), uintCV(stx_expiration), uintCV(stx_amount), principalCV(party_b.stx_address)], party_a.stx_address);

		// ETH swap intent
		await this.eth.session.contracts.EthHTLC.methods.register_swap_intent(hash, eth_expiration, party_a.eth_address).send({value: eth_amount, from: party_b.eth_address});

		// Trigger STX side
		const stx_swap = await this.stx.contract_call('.stx-htlc', 'swap', [principalCV(party_a.stx_address), bufferCV(preimage)], party_b.stx_address);
		assert.equal(stx_swap[0].result, '(ok true)');
		assert.equal(stx_swap[0].events[0].type, 'stx_transfer_event');
		assert.equal(stx_swap[0].events[0].stx_transfer_event.recipient, party_b.stx_address);
		assert.equal(stx_swap[0].events[0].stx_transfer_event.amount, stx_amount);

		// Trigger ETH side
		const eth_swap = await this.eth.session.contracts.EthHTLC.methods.swap(party_b.eth_address, preimage).send({from: eth_matcher}); // we send the swap call from a third party address so that the fees do not influence the result.
		assert.isTrue(eth_swap.status);

		// Assert that the balances increased
		assert.isTrue((await this.eth.balance(party_a.eth_address)).gt(party_a_starting_eth_balance), "ETH balance did not increase");
		assert.isTrue((await this.stx.balance(party_b.stx_address)).gt(party_b_starting_stx_balance), "STX balance did not increase");
		});

	it('Can swap SIP009 and ETH',async function()
		{
		const party_a_stx_wallet = this.stx.session.accounts.wallet_1;
		const sip009 = await sip009_mint(this.stx, party_a_stx_wallet.address);

		const options = {
			party_a_stx_wallet,
			stx_asset_contract: sip009.asset_contract,
			stx_asset_type: 'sip009',
			stx_amount_or_token_id: sip009.value,
			eth_amount_or_token_id: new BN(1500000000),
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);
		
		const party_a_starting_eth_balance = await this.eth.balance(eth_side.recipient);

		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip009.asset_contract, whitelisted: true}]);
		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);

		assert.isTrue((await this.eth.balance(eth_side.recipient)).gt(party_a_starting_eth_balance), "ETH balance did not increase");
		assert.equal(stx_side.recipient, await sip009_owner(this.stx, sip009.value), "Wrong SIP009 owner");
		});

	it('Can swap SIP010 and ETH',async function()
		{
		const party_a_stx_wallet = this.stx.session.accounts.wallet_1;
		const sip010_amount = new BN(1040);
		const sip010 = await sip010_mint(this.stx, party_a_stx_wallet.address, sip010_amount);
		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip010.asset_contract, whitelisted: true}]);

		const options = {
			party_a_stx_wallet,
			stx_asset_contract: sip010.asset_contract,
			stx_asset_type: 'sip010',
			stx_amount_or_token_id: sip010_amount,
			eth_amount_or_token_id: new BN(1250000000),
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);

		const party_a_starting_eth_balance = await this.eth.balance(eth_side.recipient);
		const party_b_sip010_starting_balance = await sip010_balance(this.stx, stx_side.recipient);

		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);

		assert.isTrue((await this.eth.balance(eth_side.recipient)).gt(party_a_starting_eth_balance), "ETH balance did not increase");
		assert.isTrue((await sip010_balance(this.stx, stx_side.recipient)).sub(party_b_sip010_starting_balance).eq(sip010_amount), "SIP010 balance did not increase by the right amount");
		});

	it('Can swap STX and ERC20',async function()
		{
		const erc20_amount = new BN(500);
		const party_b_eth_wallet = this.eth.session.accounts[2];
		const erc20 = await erc20_mint(this.eth, party_b_eth_wallet, erc20_amount);
		await erc20_approve_htlc(this.eth, party_b_eth_wallet);

		const options = {
			party_b_eth_wallet,
			stx_amount_or_token_id: new BN(2000),
			eth_asset_contract: erc20.asset_contract,
			eth_amount_or_token_id: erc20.value,
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);

		const party_a_starting_erc20_balance = await erc20_balance(this.eth, eth_side.recipient);
		const party_b_starting_stx_balance = await this.stx.balance(stx_side.recipient);

		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);
		
		assert.isTrue((await erc20_balance(this.eth, eth_side.recipient)).sub(party_a_starting_erc20_balance).eq(erc20_amount), "ERC20 balance did not increase by the right amount");
		assert.isTrue((await this.stx.balance(stx_side.recipient)).gt(party_b_starting_stx_balance), "STX balance did not increase");
		});

	it('Can swap STX and ERC721',async function()
		{
		const party_b_eth_wallet = this.eth.session.accounts[2];
		const erc721 = await erc721_mint(this.eth, party_b_eth_wallet);
		await erc721_approve_htlc(this.eth, party_b_eth_wallet);

		const options = {
			party_b_eth_wallet,
			stx_amount_or_token_id: new BN(8600),
			eth_asset_contract: erc721.asset_contract,
			eth_amount_or_token_id: erc721.tokenId,
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);

		const party_b_starting_stx_balance = await this.stx.balance(stx_side.recipient);

		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);
		
		assert.equal(eth_side.recipient, await erc721_owner(this.eth, erc721.tokenId), "Wrong ERC721 owner");
		assert.isTrue((await this.stx.balance(stx_side.recipient)).gt(party_b_starting_stx_balance), "STX balance did not increase");
		});

	it('Can swap SIP009 and ERC20',async function()
		{
		const party_a_stx_wallet = this.stx.session.accounts.wallet_1;
		const sip009 = await sip009_mint(this.stx, party_a_stx_wallet.address);
		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip009.asset_contract, whitelisted: true}]);

		const erc20_amount = new BN(500);
		const party_b_eth_wallet = this.eth.session.accounts[2];
		const erc20 = await erc20_mint(this.eth, party_b_eth_wallet, erc20_amount);
		await erc20_approve_htlc(this.eth, party_b_eth_wallet);

		const options = {
			party_a_stx_wallet,
			stx_asset_contract: sip009.asset_contract,
			stx_asset_type: 'sip009',
			stx_amount_or_token_id: sip009.value,
			party_b_eth_wallet,
			eth_asset_contract: erc20.asset_contract,
			eth_amount_or_token_id: erc20.value,
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);

		const party_a_starting_erc20_balance = await erc20_balance(this.eth, eth_side.recipient);

		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);
		
		assert.isTrue((await erc20_balance(this.eth, eth_side.recipient)).sub(party_a_starting_erc20_balance).eq(erc20_amount), "ERC20 balance did not increase by the right amount");
		assert.equal(stx_side.recipient, await sip009_owner(this.stx, sip009.value), "Wrong SIP009 owner");
		});

	it('Can swap SIP009 and ERC721',async function()
		{
		const party_a_stx_wallet = this.stx.session.accounts.wallet_1;
		const sip009 = await sip009_mint(this.stx, party_a_stx_wallet.address);
		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip009.asset_contract, whitelisted: true}]);
		
		const party_b_eth_wallet = this.eth.session.accounts[2];
		const erc721 = await erc721_mint(this.eth, party_b_eth_wallet);
		await erc721_approve_htlc(this.eth, party_b_eth_wallet);

		const options = {
			party_a_stx_wallet,
			party_b_eth_wallet,
			stx_asset_contract: sip009.asset_contract,
			stx_asset_type: 'sip009',
			stx_amount_or_token_id: sip009.value,
			eth_asset_contract: erc721.asset_contract,
			eth_amount_or_token_id: erc721.tokenId,
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);
		
		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);

		assert.equal(eth_side.recipient, await erc721_owner(this.eth, erc721.tokenId), "Wrong ERC721 owner");
		assert.equal(stx_side.recipient, await sip009_owner(this.stx, sip009.value), "Wrong SIP009 owner");
		});

	it('Can swap SIP010 and ERC20',async function()
		{
		const party_a_stx_wallet = this.stx.session.accounts.wallet_1;
		const sip010_amount = new BN(41090);
		const sip010 = await sip010_mint(this.stx, party_a_stx_wallet.address, sip010_amount);
		const erc20_amount = new BN(832);
		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip010.asset_contract, whitelisted: true}]);

		const party_b_eth_wallet = this.eth.session.accounts[2];
		const erc20 = await erc20_mint(this.eth, party_b_eth_wallet, erc20_amount);
		await erc20_approve_htlc(this.eth, party_b_eth_wallet);

		const options = {
			party_a_stx_wallet,
			party_b_eth_wallet,
			stx_asset_contract: sip010.asset_contract,
			stx_asset_type: 'sip010',
			stx_amount_or_token_id: sip010_amount,
			eth_asset_contract: erc20.asset_contract,
			eth_amount_or_token_id: erc20.value,
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);

		const party_a_starting_erc20_balance = await erc20_balance(this.eth, eth_side.recipient);
		const party_b_sip010_starting_balance = await sip010_balance(this.stx, stx_side.recipient);

		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);

		assert.isTrue((await erc20_balance(this.eth, eth_side.recipient)).sub(party_a_starting_erc20_balance).eq(erc20_amount), "ERC20 balance did not increase by the right amount");
		assert.isTrue((await sip010_balance(this.stx, stx_side.recipient)).sub(party_b_sip010_starting_balance).eq(sip010_amount), "SIP010 balance did not increase by the right amount");
		});

	it('Can swap SIP010 and ERC721',async function()
		{
		const party_a_stx_wallet = this.stx.session.accounts.wallet_1;
		const sip010_amount = new BN(41090);
		const sip010 = await sip010_mint(this.stx, party_a_stx_wallet.address, sip010_amount);
		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip010.asset_contract, whitelisted: true}]);

		const party_b_eth_wallet = this.eth.session.accounts[2];
		const erc721 = await erc721_mint(this.eth, party_b_eth_wallet);
		await erc721_approve_htlc(this.eth, party_b_eth_wallet);

		const options = {
			party_a_stx_wallet,
			party_b_eth_wallet,
			stx_asset_contract: sip010.asset_contract,
			stx_asset_type: 'sip010',
			stx_amount_or_token_id: sip010_amount,
			eth_asset_contract: erc721.asset_contract,
			eth_amount_or_token_id: erc721.tokenId,
			stx_chain: this.stx,
			eth_chain: this.eth
			};
		
		const {preimage, hash, stx_side, eth_side} = await generate_standard_swap_intents(options);

		const party_b_sip010_starting_balance = await sip010_balance(this.stx, stx_side.recipient);

		await register_swap_intents(hash, stx_side, eth_side);
		await execute_swaps(preimage, stx_side, eth_side);

		assert.equal(eth_side.recipient, await erc721_owner(this.eth, erc721.tokenId), "Wrong ERC721 owner");
		assert.isTrue((await sip010_balance(this.stx, stx_side.recipient)).sub(party_b_sip010_starting_balance).eq(sip010_amount), "SIP010 balance did not increase by the right amount");
		});
	});