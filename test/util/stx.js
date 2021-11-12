const spawn = require('child_process').spawn;
const readline = require('readline');
const BN = require('bn.js');
const assert = require('assert');
const {buffer_to_hex} = require('./common');

const DEBUG = !!process.env.DEBUG;

function wrap_clarinet_process(child,ready)
	{
	let rl = readline.createInterface({input: child.stdout, terminal: true});
	let running = false;
	const queue = [];
	const session = {};
	let block_height = 0;

	rl.on('line',line =>
		{
		if (!running)
			{
			try
				{
				const response = JSON.parse(line);
				if (response.ready)
					{
					running = true;
					session.accounts = response.accounts;
					session.contracts = response.contracts;
					DEBUG && console.debug(`Received Clarinet session state: ${line}`);
					ready();
					}
				}
			catch (e){}
			return;
			}
		DEBUG && console.debug(`STX: ${line}`);
		if (!queue.length)
			return;
		const [resolve,reject,op] = queue.shift();
		try
			{
			const response = JSON.parse(line);
			if (response && response.result && response.result.block_height)
				block_height = response.result.block_height;
			switch (op)
				{
				case "mine_empty_blocks": return resolve(response.result.block_height);
				case "call_read_only_fn": return resolve({result: response.result.result, events: response.result.events});
				case "mine_block": return resolve(response.result.receipts);
				case "get_assets_maps": return resolve(response.result.assets);
				}
			resolve(response);
			}
		catch (error)
			{
			reject({error,line});
			}
		});

	return {
		child,
		session_id: 0,
		request_id: 0,
		session,
		block_height: async (increment) =>
			{
			const height = new BN(block_height);
			return increment ? height.add(new BN(increment)) : height;
			},
		send: async function (op,params)
			{
			if (!running)
				return Promise.reject("not running");
			return new Promise((resolve,reject) =>
				{
				queue.push([resolve,reject,op]);
				DEBUG && console.debug(`Sending to Clarinet session: ${JSON.stringify({op,params})}`);
				this.child.stdin.write(JSON.stringify({id: this.request_id++, op, params})+"\n");
				});
			},
		mine_empty_blocks: async function(count)
			{
			return this.send("mine_empty_blocks",{sessionId: this.session_id, count});
			},
		contract_call: async function(contract,function_name,function_args,sender)
			{
			if (contract[0] === '.')
				contract = this.session.accounts.deployer.address + contract;
			const transactions = 
				[
					{
					type: 2, // contract call
					sender: sender || this.session.accounts.deployer.address,
					contractCall:
						{
						contract,
						method: function_name,
						args: function_args || []
						}
					}
				];
			return this.send("mine_block",{sessionId: this.session_id, transactions});
			},
		read_only_call: async function(contract,function_name,function_args,sender)
			{
			if (contract[0] === '.')
				contract = this.session.accounts.deployer.address + contract;
			return this.send("call_read_only_fn",
				{
				sessionId: this.session_id,
				contract,
				method: function_name,
				args: function_args,
				sender: sender || this.session.accounts.deployer.address
				});
			},
		asset_maps: async function()
			{
			return this.send("get_assets_maps", {sessionId: this.session_id});
			},
		balance: async function(principal)
			{
			const assets = await this.asset_maps();
			return new BN(assets.STX[principal] || 0);
			},
		kill: function (signal)
			{
			queue.forEach(([,reject]) => reject());
			rl.close();
			this.child.kill(signal);
			}
		};
	}

async function start_stx_chain()
	{
	return new Promise((resolve,reject) =>
		{
		const child = spawn("npm run stx-test-rpc",{shell: true});
		child.on('error',reject);
		child.on('exit',code => code > 0 && reject(`Clarinet process exited with ${code}. Set DEBUG=1 for more information.`))
		const clarinet_session = wrap_clarinet_process(child,() => resolve(clarinet_session));
		});
	}

function uintCV(uint)
	{
	if (typeof uint === 'string' && uint[0] === 'u')
		return uint;
	return `u${uint.toString()}`;
	}

function principalCV(principal)
	{
	return `'${typeof principal === 'string' ? principal : principal.address}`;
	}

function bufferCV(buffer)
	{
	return buffer_to_hex(buffer);
	}

function listCV(list)
	{
	return `(list ${list.join(' ')})`;
	}

function booleanCV(bool)
	{
	return bool && 'true' || 'false';
	}

function tupleCV(obj)
	{
	return '{' + Object.entries(obj).map(([key, value]) => `${key}: ${value}`).join(', ') + '}';
	}

async function stx_register_swap_intent(options)
	{
	const {
		stx_chain, // object, STX chain instance from start_stx_chain()
		contract_name,
		sender, // principal
		recipient, // principal
		hash, // string,
		amount_or_token_id, // BN, amount for STX or SIP010, token ID for SIP009
		expiration_height, // BN, expiration block height
		asset_contract, // principal | null, null for STX swap
		asset_type // null | "sip009" | "sip010"
		} = options;
	if (!stx_chain || !sender || !recipient || !hash || !amount_or_token_id || !expiration_height)
		throw new Error(`Missing options`);
	const contract_principal = contract_name || (asset_contract ? '.sip009-sip010-htlc' : '.stx-htlc');
	const parameters = [bufferCV(hash), uintCV(expiration_height), uintCV(amount_or_token_id), principalCV(recipient)];
	if (asset_contract)
		parameters.push(principalCV(asset_contract));
	return stx_chain.contract_call(contract_principal, asset_contract ? `register-swap-intent-${asset_type}` : 'register-swap-intent', parameters, sender);
	}

async function stx_execute_swap(options)
	{
	const {
		stx_chain, // object, STX chain instance from start_stx_chain()
		preimage,
		contract_name,
		sender, // principal
		transaction_sender, // principal
		asset_contract, // principal | null, null for STX swap
		asset_type // null | "sip009" | "sip010"
		} = options;
	const contract_principal = contract_name || (asset_contract ? '.sip009-sip010-htlc' : '.stx-htlc');
	const parameters = [principalCV(sender), bufferCV(preimage)];
	if (asset_contract)
		parameters.push(principalCV(asset_contract));
	return stx_chain.contract_call(contract_principal, asset_contract ? `swap-${asset_type}` : 'swap', parameters, transaction_sender || sender);
	}

async function stx_verify_swap(swap_intent,swap_result)
	{
	const {
		recipient, // principal
		amount_or_token_id, // BN, amount for STX or SIP010, token ID for SIP009
		asset_contract // principal | null, null for STX swap
		} = swap_intent;
	if (Array.isArray(swap_result))
		swap_result = swap_result[0];
	const {result, events} = swap_result;
	assert(result === '(ok true)');
	assert(events.length === 1, 'Should be only one chain event');
	if (asset_contract)
		{
		assert(events[0].type === 'ft_transfer_event' || events[0].type === 'nft_transfer_event', 'Should be an FT/NFT transfer event');
		const event = events[0].ft_transfer_event || events[0].nft_transfer_event;
		assert(event.recipient === recipient, 'Wrong recipient');
		assert((new BN(event.amount)).eq(new BN(amount_or_token_id)), events[0].ft_transfer_event  ? 'Wrong amount' : 'Wrong token ID');
		}
	else
		{
		assert(events[0].type === 'stx_transfer_event', 'Should be a STX transfer event');
		assert(events[0].stx_transfer_event.recipient === recipient, 'Wrong recipient');
		assert((new BN(events[0].stx_transfer_event.amount)).eq(new BN(amount_or_token_id)), 'Wrong amount');
		}
	return true;
	}

async function sip009_mint(stx_chain, recipient)
	{
	const [response] = await stx_chain.contract_call('.test-sip009','mint',[principalCV(recipient)]);
	if (response.result.substr(0,3) !== '(ok')
		throw new Error('SIP009 minting failed');
	return {...response.events[0].nft_mint_event, asset_contract: response.events[0].nft_mint_event.asset_identifier.split('::')[0]};
	}

async function sip009_owner(stx_chain, token_id)
	{
	const response = await stx_chain.read_only_call('.test-sip009','get-owner',[uintCV(token_id)]);
	const match = response.result.match(/^\(ok \(some (.+?)\)\)$/);
	return (match && match[1]) || null;
	}

async function sip010_mint(stx_chain, recipient, amount)
	{
	const [response] = await stx_chain.contract_call('.test-sip010','mint',[uintCV(amount),principalCV(recipient)]);
	if (response.result.substr(0,3) !== '(ok')
		throw new Error('SIP010 minting failed');
	return {...response.events[0].ft_mint_event, asset_contract: response.events[0].ft_mint_event.asset_identifier.split('::')[0]};
	}

async function sip010_balance(stx_chain, principal)
	{
	const response = await stx_chain.read_only_call('.test-sip010','get-balance',[principalCV(principal)]);
	const match = response.result.match(/^\(ok u(.+?)\)$/);
	return match && new BN(match[1]) || new BN(0);
	}

async function sip009_sip010_htlc_set_whitelisted(stx_chain, list)
	{
	const list_cv = listCV(list.map(({token_contract, whitelisted}) => tupleCV({'asset-contract': principalCV(token_contract), whitelisted: booleanCV(whitelisted)})));
	const [response] = await stx_chain.contract_call('.sip009-sip010-htlc','set-whitelisted',[list_cv]);
	if (response.result.substr(0,3) !== '(ok')
		throw new Error('Whitelisting failed');
	return true;
	}

module.exports = {
	start_stx_chain,
	uintCV,
	principalCV,
	bufferCV,
	listCV,
	stx_register_swap_intent,
	stx_execute_swap,
	stx_verify_swap,
	sip009_sip010_htlc_set_whitelisted,
	sip009_mint,
	sip009_owner,
	sip010_mint,
	sip010_balance
};