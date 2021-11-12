import {
	Clarinet,
	Chain,
	Account,
	types,
	generate_secret,
	calculate_hash,
	sip009_sip010_htlc_set_whitelisted,
	swap_contract_principal,
	register_swap_intent,
	get_swap_intent,
	cancel_swap_intent,
	execute_swap,
	sip009_mint,
	sip010_mint,
	ErrorCodes,
	SwapIntent
} from './common.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

interface Sip009NftTransferEvent {
	type: string,
	nft_transfer_event: {
		asset_identifier: string,
		sender: string,
		recipient: string,
		value: string
	}
}

function assertNftTransfer(event: Sip009NftTransferEvent, asset_contract_principal: string, token_id: number, sender: string, recipient: string) {
	assertEquals(typeof event, 'object');
	assertEquals(event.type, 'nft_transfer_event');
	assertEquals(event.nft_transfer_event.asset_identifier.substr(0, asset_contract_principal.length), asset_contract_principal);
	event.nft_transfer_event.sender.expectPrincipal(sender);
	event.nft_transfer_event.recipient.expectPrincipal(recipient);
	event.nft_transfer_event.value.expectUint(token_id);
}

Clarinet.test({
	name: "SIP009: can register a swap intent",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectOk().expectBool(true);
		assertNftTransfer(swap.events[0], token_contract, token_id, sender.address, swap_contract);
	}
});

Clarinet.test({
	name: "SIP009: cannot register a swap intent for non-whitelisted token",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_ASSET_CONTRACT_NOT_WHITELISTED);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009: can retrieve a swap intent",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		const swap = get_swap_intent(chain, swap_contract, hash, sender.address);
		const result = swap.result.expectSome().expectTuple();
		assertEquals(result, {
			"amount-or-token-id": types.uint(swap_intent.amount_or_token_id),
			"expiration-height": types.uint(swap_intent.expiration_height),
			"recipient": swap_intent.recipient,
			"asset-contract": token_contract
		});
	}
});

Clarinet.test({
	name: "SIP009: sender cannot pledge a token it does not own",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, third_party.address);
		const swap_intent: SwapIntent = {
			hash: new Uint8Array(new ArrayBuffer(32)),
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_NFT_TRANSFER_NOT_OWNER);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009: sender can cancel a swap intent after expiry",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight + 1);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent);
		cancellation.result.expectOk().expectBool(true);
		assertNftTransfer(cancellation.events[0], token_contract, token_id, swap_contract, sender.address);
	}
});

Clarinet.test({
	name: "SIP009: anyone can trigger swap before expiry using the correct preimage",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		const swap = execute_swap(chain, swap_contract, swap_intent, secret, third_party.address);
		swap.result.expectOk().expectBool(true);
		assertNftTransfer(swap.events[0], token_contract, token_id, swap_contract, recipient.address);
	}
});

Clarinet.test({
	name: "SIP010: can retrieve a swap intent",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip010`;
		const amount = 198;
		sip010_mint(chain, token_contract, amount, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: amount,
			asset_contract: token_contract,
			asset_type: "sip010",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		const swap = get_swap_intent(chain, swap_contract, hash, sender.address);
		const result = swap.result.expectSome().expectTuple();
		assertEquals(result, {
			"amount-or-token-id": types.uint(swap_intent.amount_or_token_id),
			"expiration-height": types.uint(swap_intent.expiration_height),
			"recipient": swap_intent.recipient,
			"asset-contract": token_contract
		});
	}
});

Clarinet.test({
	name: "SIP010: can register a swap intent",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip010`;
		const amount = 144;
		const { asset_identifier } = sip010_mint(chain, token_contract, amount, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: amount,
			asset_contract: token_contract,
			asset_type: "sip010",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectOk().expectBool(true);
		swap.events.expectFungibleTokenTransferEvent(amount, sender.address, swap_contract, asset_identifier);
	}
});

Clarinet.test({
	name: "SIP010: amount cannot be 0",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip010`;
		const swap_intent: SwapIntent = {
			hash: new Uint8Array(new ArrayBuffer(32)),
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 0,
			asset_contract: token_contract,
			asset_type: "sip010",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_FT_TRANSFER_NON_POSITIVE);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP010: sender cannot pledge more tokens than owned",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip010`;
		const amount = 400;
		sip010_mint(chain, token_contract, amount, sender.address);
		const swap_intent: SwapIntent = {
			hash: new Uint8Array(new ArrayBuffer(32)),
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: amount + 100,
			asset_contract: token_contract,
			asset_type: "sip010",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_FT_TRANSFER_INSUFFICIENT_BALANCE);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP010: sender can cancel a swap intent after expiry",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip010`;
		const amount = 567;
		const { asset_identifier } = sip010_mint(chain, token_contract, amount, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: amount,
			asset_contract: token_contract,
			asset_type: "sip010",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight + 1);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent);
		cancellation.result.expectOk().expectBool(true);
		cancellation.events.expectFungibleTokenTransferEvent(amount, swap_contract, sender.address, asset_identifier);
	}
});

Clarinet.test({
	name: "SIP010: anyone can trigger swap before expiry using the correct preimage",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip010`;
		const amount = 783;
		const { asset_identifier } = sip010_mint(chain, token_contract, amount, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: amount,
			asset_contract: token_contract,
			asset_type: "sip010",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		const swap = execute_swap(chain, swap_contract, swap_intent, secret, third_party.address);
		swap.result.expectOk().expectBool(true);
		swap.events.expectFungibleTokenTransferEvent(amount, swap_contract, recipient.address, asset_identifier);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: sender cannot cancel a swap intent before expiry",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight - 1);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent);
		cancellation.result.expectErr().expectUint(ErrorCodes.ERR_SWAP_INTENT_NOT_EXPIRED);
		assertEquals(cancellation.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: sender cannot cancel a swap that does not exist",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 45,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent);
		cancellation.result.expectErr().expectUint(ErrorCodes.ERR_UNKNOWN_SWAP_INTENT);
		assertEquals(cancellation.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: third party cannot cancel a swap intent after expiry",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight + 1);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent, third_party.address);
		cancellation.result.expectErr().expectUint(ErrorCodes.ERR_UNKNOWN_SWAP_INTENT);
		assertEquals(cancellation.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: hash has to be 32 bytes in length",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const swap_intent: SwapIntent = {
			hash: new Uint8Array(new ArrayBuffer(31)),
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 1,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_INVALID_HASH_LENGTH);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: expiration height cannot be in the past",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		chain.mineEmptyBlock(5);
		const token_contract = `${deployer.address}.test-sip009`;
		const swap_intent: SwapIntent = {
			hash: new Uint8Array(new ArrayBuffer(32)),
			expiration_height: chain.blockHeight - 1,
			amount_or_token_id: 1,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_EXPIRY_IN_PAST);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: swap intent cannot already exist",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		const second_swap = register_swap_intent(chain, swap_contract, swap_intent);
		second_swap.result.expectErr().expectUint(ErrorCodes.ERR_SWAP_INTENT_ALREADY_EXISTS);
		assertEquals(second_swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: nobody can trigger swap after expiry using the correct preimage",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const { token_id } = sip009_mint(chain, token_contract, sender.address);
		const swap_intent: SwapIntent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: token_id,
			asset_contract: token_contract,
			asset_type: "sip009",
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		sip009_sip010_htlc_set_whitelisted(chain, swap_contract, [{ token_contract, whitelisted: true }], deployer.address);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight + 1);
		const swap = execute_swap(chain, swap_contract, swap_intent, secret, third_party.address);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_SWAP_INTENT_EXPIRED);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "SIP009/SIP010: only owner can whitelist a token contract",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, non_owner] = ['deployer', 'wallet_1'].map(name => accounts.get(name)!);
		const token_contract = `${deployer.address}.test-sip009`;
		const whitelisted = sip009_sip010_htlc_set_whitelisted(chain, 'sip009-sip010-htlc', [{ token_contract, whitelisted: true }], non_owner.address);
		whitelisted.result.expectErr().expectUint(ErrorCodes.ERR_OWNER_ONLY);
	}
});
