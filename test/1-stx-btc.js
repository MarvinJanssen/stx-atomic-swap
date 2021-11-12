const assert = require('chai').assert;
const BN = require('bn.js');

const {
	start_stx_chain,
	start_btc_chain,
	generate_secret,
	calculate_hash,
	stx_register_swap_intent,
	stx_execute_swap,
	sip009_mint,
	sip009_owner,
	sip010_mint,
	sip010_balance,
	sip009_sip010_htlc_set_whitelisted,
	btc_register_swap_intent,
	btc_execute_swap,
	btc_refund_swap_intent
	} = require('./util');

describe('STX <> BTC',async function()
	{
	before(async function() 
		{
		console.debug("Starting STX and BTC chains...");
		console.debug("");
		let stx_chain_process, btc_chain_process;
		const kill = () =>
			{
			console.log('Stopping chains...');
			try {stx_chain_process.kill('SIGINT');} catch(e){};
			try {btc_chain_process.kill('SIGINT');} catch(e){};
			};
		process.on('SIGINT',kill);
		process.on('uncaughtException',kill);
		try
			{
			[stx_chain_process,btc_chain_process] = await Promise.all([start_stx_chain(),start_btc_chain()]);
			}
		catch (error)
			{
			console.error(error);
			kill();
			process.exit(1);
			}
		this.stx = stx_chain_process;
		this.btc = btc_chain_process;
		});

	after(function()
		{
		console.debug("Stopping chains...");
		this.stx.kill();
		this.btc.kill();
		});

	it("Can swap STX and BTC",async function()
		{
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		const stx_expiration = await this.stx.block_height(10);
		const stx_amount = 340;
		const btc_expiration = (await this.btc.block_height(20)).toNumber();
		const btc_amount = 1.3; // 1.3 BTC
		const {deployer, wallet_1} = this.stx.session.accounts;
		const [, btc_wallet_1, btc_wallet_2] = this.btc.session.accounts;

		const party_a = {
			stx_address: deployer.address,
			btc_account: btc_wallet_1
			};

		const party_b = {
			stx_address: wallet_1.address,
			btc_account: btc_wallet_2
			};

		// STX side
		const stx_side = {
			stx_chain: this.stx,
			sender: party_a.stx_address,
			recipient: party_b.stx_address,
			hash,
			amount_or_token_id: stx_amount,
			expiration_height: stx_expiration
			};
		
		await stx_register_swap_intent(stx_side);


		// BTC side
		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		const party_a_starting_btc_balance = await this.btc.balance(party_a.btc_account.address);
		const party_b_starting_stx_balance = await this.stx.balance(party_b.stx_address);

		// Execute swap
		const stx_swap = await stx_execute_swap({
			...stx_side,
			preimage: secret
			});

		const btc_swap = await btc_execute_swap({
			...btc_side,
			btc_chain: this.btc,
			preimage: secret,
			recipient: party_a.btc_account
			});
			
		assert.isOk(stx_swap);
		assert.isOk(btc_swap);
		assert.equal(((await this.btc.balance(party_a.btc_account.address)) - party_a_starting_btc_balance).toFixed(8), btc_amount.toFixed(8), "Unexpected BTC balance");
		assert.isTrue((await this.stx.balance(party_b.stx_address)).gt(party_b_starting_stx_balance), "STX balance did not increase");
		});

	it("Can swap SIP009 and BTC",async function()
		{
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		
		const {deployer, wallet_1} = this.stx.session.accounts;
		const [, btc_wallet_1, btc_wallet_2] = this.btc.session.accounts;

		const party_a = {
			stx_address: deployer.address,
			btc_account: btc_wallet_1
			};

		const party_b = {
			stx_address: wallet_1.address,
			btc_account: btc_wallet_2
			};

		const sip009 = await sip009_mint(this.stx, party_a.stx_address);
		const stx_expiration = await this.stx.block_height(10);
		const btc_expiration = (await this.btc.block_height(20)).toNumber();
		const btc_amount = 1.6;

		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip009.asset_contract, whitelisted: true}]);

		// STX side
		const stx_side = {
			stx_chain: this.stx,
			sender: party_a.stx_address,
			recipient: party_b.stx_address,
			hash,
			amount_or_token_id: sip009.value,
			expiration_height: stx_expiration,
			asset_contract: sip009.asset_contract,
			asset_type: 'sip009'
			};
		
		await stx_register_swap_intent(stx_side);

		// BTC side
		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		const party_a_starting_btc_balance = await this.btc.balance(party_a.btc_account.address);

		// Execute swap
		await stx_execute_swap({
			...stx_side,
			preimage: secret
			});

		await btc_execute_swap({
			...btc_side,
			btc_chain: this.btc,
			preimage: secret,
			recipient: party_a.btc_account
			});
			
		assert.equal(((await this.btc.balance(party_a.btc_account.address)) - party_a_starting_btc_balance).toFixed(8), btc_amount.toFixed(8), "Unexpected BTC balance");
		assert.equal(party_b.stx_address, await sip009_owner(this.stx, sip009.value), "Wrong SIP009 owner");
		});

	it("Can swap SIP010 and BTC",async function()
		{
		const secret = await generate_secret();
		const hash = calculate_hash(secret);
		
		const {deployer, wallet_1} = this.stx.session.accounts;
		const [, btc_wallet_1, btc_wallet_2] = this.btc.session.accounts;

		const party_a = {
			stx_address: deployer.address,
			btc_account: btc_wallet_1
			};

		const party_b = {
			stx_address: wallet_1.address,
			btc_account: btc_wallet_2
			};

		const sip010_amount = new BN(5660);
		const sip010 = await sip010_mint(this.stx, party_a.stx_address, sip010_amount);
		const stx_expiration = await this.stx.block_height(10);
		const btc_expiration = (await this.btc.block_height(20)).toNumber();
		const btc_amount = 1.7;

		await sip009_sip010_htlc_set_whitelisted(this.stx, [{token_contract: sip010.asset_contract, whitelisted: true}]);

		// STX side
		const stx_side = {
			stx_chain: this.stx,
			sender: party_a.stx_address,
			recipient: party_b.stx_address,
			hash,
			amount_or_token_id: sip010_amount,
			expiration_height: stx_expiration,
			asset_contract: sip010.asset_contract,
			asset_type: 'sip010'
			};
		
		await stx_register_swap_intent(stx_side);

		// BTC side
		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		const party_a_starting_btc_balance = await this.btc.balance(party_a.btc_account.address);
		const party_b_sip010_starting_balance = await sip010_balance(this.stx, stx_side.recipient);

		// Execute swap
		await stx_execute_swap({
			...stx_side,
			preimage: secret
			});

		await btc_execute_swap({
			...btc_side,
			btc_chain: this.btc,
			preimage: secret,
			recipient: party_a.btc_account
			});
			
		assert.equal(((await this.btc.balance(party_a.btc_account.address)) - party_a_starting_btc_balance).toFixed(8), btc_amount.toFixed(8), "Unexpected BTC balance");
		assert.isTrue((await sip010_balance(this.stx, stx_side.recipient)).sub(party_b_sip010_starting_balance).eq(sip010_amount), "SIP010 balance did not increase by the right amount");
		});

	it("BTC HTLC rejects wrong preimage",async function()
		{
		const secret = await generate_secret(); // shorter for BTC
		const hash = calculate_hash(secret);
		const btc_expiration = (await this.btc.block_height(20)).toNumber();
		const btc_amount = 1.8;

		const party_a = {btc_account: this.btc.session.accounts[1]};
		const party_b = {btc_account: this.btc.session.accounts[2]};

		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		const btc_swap = btc_execute_swap({
			...btc_side,
			btc_chain: this.btc,
			preimage: Buffer.from('bogus'),
			recipient: party_a.btc_account
			});
			
		return btc_swap
			.then(
				() => assert.fail('Should have failed'),
				error => assert.include(error.message, 'non-mandatory-script-verify-flag')
			);
		});

	it("Sender can recover BTC from HTLC after expiry",async function()
		{
		const secret = await generate_secret(); // shorter for BTC
		const hash = calculate_hash(secret);
		const btc_blocks = 20;
		const btc_expiration = (await this.btc.block_height(btc_blocks)).toNumber();
		const btc_amount = 1.9;

		const party_a = {btc_account: this.btc.session.accounts[1]};
		const party_b = {btc_account: this.btc.session.accounts[2]};

		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		const party_b_starting_btc_balance = await this.btc.balance(party_b.btc_account.address);

		await this.btc.mine_empty_blocks(btc_blocks); // advance chain

		const btc_swap = await btc_refund_swap_intent({
			...btc_side,
			btc_chain: this.btc,
			preimage: Buffer.from([]),
			recipient: party_b.btc_account
			});
			
		assert.isOk(btc_swap);
		assert.equal(((await this.btc.balance(party_b.btc_account.address)) - party_b_starting_btc_balance).toFixed(8), btc_amount.toFixed(8), "Unexpected BTC balance");
		});

	it("Sender cannot recover BTC from HTLC before expiry",async function()
		{
		const secret = await generate_secret(); // shorter for BTC
		const hash = calculate_hash(secret);
		const btc_blocks = 20;
		const btc_expiration = (await this.btc.block_height(btc_blocks)).toNumber();
		const btc_amount = 2.1;

		const party_a = {btc_account: this.btc.session.accounts[1]};
		const party_b = {btc_account: this.btc.session.accounts[2]};

		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		return btc_refund_swap_intent({
			...btc_side,
			btc_chain: this.btc,
			preimage: Buffer.from([]),
			recipient: party_b.btc_account
			})
			.then(
				() => assert.fail('Should have failed'),
				error => assert.include(error.message,'non-final')
			);
		});

	it("Receiver cannot recover BTC from HTLC after expiry",async function()
		{
		const secret = await generate_secret(); // shorter for BTC
		const hash = calculate_hash(secret);
		const btc_blocks = 20;
		const btc_expiration = (await this.btc.block_height(btc_blocks)).toNumber();
		const btc_amount = 2.2;

		const party_a = {btc_account: this.btc.session.accounts[1]};
		const party_b = {btc_account: this.btc.session.accounts[2]};

		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		await this.btc.mine_empty_blocks(btc_blocks); // advance chain
			
		return btc_refund_swap_intent({
			...btc_side,
			btc_chain: this.btc,
			preimage: Buffer.from([]),
			recipient: party_a.btc_account
			})
			.then(
				() => assert.fail('Should have failed'),
				error => assert.include(error.message,'non-mandatory-script-verify-flag')
			);
		});

	it("Sender cannot recover BTC from HTLC with preimage",async function()
		{
		const secret = await generate_secret(); // shorter for BTC
		const hash = calculate_hash(secret);
		const btc_blocks = 20;
		const btc_expiration = (await this.btc.block_height(btc_blocks)).toNumber();
		const btc_amount = 2.3;

		const party_a = {btc_account: this.btc.session.accounts[1]};
		const party_b = {btc_account: this.btc.session.accounts[2]};

		const btc_side = await btc_register_swap_intent({
			btc_chain: this.btc,
			sender: party_b.btc_account,
			recipient_public_key: party_a.btc_account.publicKey,
			hash,
			amount: btc_amount,
			expiration_height: btc_expiration,
			network: 'regtest',
			tx_fee_sat: 500
			});

		return btc_execute_swap({
			...btc_side,
			btc_chain: this.btc,
			preimage: secret,
			recipient: party_b.btc_account
			})
			.then(
				() => assert.fail('Should have failed'),
				error => assert.include(error.message, 'non-mandatory-script-verify-flag')
			);
		});
	});