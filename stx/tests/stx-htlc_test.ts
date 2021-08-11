import {
	Clarinet,
	Chain,
	Account,
	types,
	generate_secret,
	calculate_hash,
	swap_contract_principal,
	register_swap_intent,
	get_swap_intent,
	cancel_swap_intent,
	execute_swap,
	ErrorCodes
} from './common.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

Clarinet.test({
	name: "Can register a swap intent",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 100,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectOk().expectBool(true);
		swap.events.expectSTXTransferEvent(swap_intent.amount_or_token_id, sender.address, swap_contract);
	}
});

Clarinet.test({
	name: "Can retrieve a swap intent",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 100,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		register_swap_intent(chain, swap_contract, swap_intent);
		const swap = get_swap_intent(chain, swap_contract, hash, sender.address);
		const result = swap.result.expectSome().expectTuple();
		assertEquals(result, {
			"amount": types.uint(swap_intent.amount_or_token_id),
			"expiration-height": types.uint(swap_intent.expiration_height),
			"recipient": swap_intent.recipient
		});
	}
});

Clarinet.test({
	name: "Hash has to be 32 bytes in length",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash: new Uint8Array(new ArrayBuffer(31)),
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 110,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_INVALID_HASH_LENGTH);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "Expiration height cannot be in the past",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		chain.mineEmptyBlock(5);
		const swap_intent = {
			hash: new Uint8Array(new ArrayBuffer(32)),
			expiration_height: chain.blockHeight - 1,
			amount_or_token_id: 120,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_EXPIRY_IN_PAST);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "Swap intent cannot already exist",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 130,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		register_swap_intent(chain, swap_contract, swap_intent);
		const second_swap = register_swap_intent(chain, swap_contract, swap_intent);
		second_swap.result.expectErr().expectUint(ErrorCodes.ERR_SWAP_INTENT_ALREADY_EXISTS);
		assertEquals(second_swap.events.length, 0);
	}
});

Clarinet.test({
	name: "Amount cannot be 0",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash: new Uint8Array(new ArrayBuffer(32)),
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 0,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_STX_TRANSFER_NON_POSITIVE);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "Sender cannot pledge more STX than owned",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash: new Uint8Array(new ArrayBuffer(32)),
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: sender.balance + 100,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		const swap = register_swap_intent(chain, swap_contract, swap_intent);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_STX_TRANSFER_INSUFFICIENT_BALANCE);
		assertEquals(swap.events.length, 0);
	}
});

Clarinet.test({
	name: "Sender can cancel a swap intent after expiry",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 140,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight + 1);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent);
		cancellation.result.expectOk().expectBool(true);
		cancellation.events.expectSTXTransferEvent(swap_intent.amount_or_token_id, swap_contract, sender.address);
	}
});

Clarinet.test({
	name: "Sender cannot cancel a swap intent before expiry",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 150,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight - 1);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent);
		cancellation.result.expectErr().expectUint(ErrorCodes.ERR_SWAP_INTENT_NOT_EXPIRED);
		assertEquals(cancellation.events.length, 0);
	}
});

Clarinet.test({
	name: "Sender cannot cancel a swap that does not exist",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 160,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent);
		cancellation.result.expectErr().expectUint(ErrorCodes.ERR_UNKNOWN_SWAP_INTENT);
		assertEquals(cancellation.events.length, 0);
	}
});

Clarinet.test({
	name: "Third party cannot cancel a swap intent after expiry",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 170,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight + 1);
		const cancellation = cancel_swap_intent(chain, swap_contract, swap_intent, third_party.address);
		cancellation.result.expectErr().expectUint(ErrorCodes.ERR_UNKNOWN_SWAP_INTENT);
		assertEquals(cancellation.events.length, 0);
	}
});

Clarinet.test({
	name: "Anyone can trigger swap before expiry using the correct preimage",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 180,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		register_swap_intent(chain, swap_contract, swap_intent);
		const swap = execute_swap(chain, swap_contract, swap_intent, secret, third_party.address);
		swap.result.expectOk().expectBool(true);
		swap.events.expectSTXTransferEvent(swap_intent.amount_or_token_id, swap_contract, recipient.address);
	}
});

Clarinet.test({
	name: "Nobody can trigger swap after expiry using the correct preimage",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const secret = generate_secret();
		const hash = calculate_hash(secret);
		const [deployer, sender, recipient, third_party] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
		const swap_intent = {
			hash,
			expiration_height: chain.blockHeight + 10,
			amount_or_token_id: 190,
			sender: sender.address,
			recipient: recipient.address
		};
		const swap_contract = swap_contract_principal(deployer, swap_intent);
		register_swap_intent(chain, swap_contract, swap_intent);
		chain.mineEmptyBlock(swap_intent.expiration_height - chain.blockHeight + 1);
		const swap = execute_swap(chain, swap_contract, swap_intent, secret, third_party.address);
		swap.result.expectErr().expectUint(ErrorCodes.ERR_SWAP_INTENT_EXPIRED);
		assertEquals(swap.events.length, 0);
	}
});