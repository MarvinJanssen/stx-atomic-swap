import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
export { Clarinet, Tx, Chain, types };
export type { Account };

import { createHash } from "https://deno.land/std@0.104.0/hash/mod.ts";

export const ErrorCodes = {
	// built-in error codes
	ERR_STX_TRANSFER_INSUFFICIENT_BALANCE: 1,
	ERR_STX_TRANSFER_NON_POSITIVE: 3,

	ERR_NFT_TRANSFER_NOT_OWNER: 1,
	ERR_NFT_TRANSFER_UNKNOWN_ASSET: 3,

	ERR_FT_TRANSFER_INSUFFICIENT_BALANCE: 1,
	ERR_FT_TRANSFER_NON_POSITIVE: 3,

	// HTLC error codes
	ERR_INVALID_HASH_LENGTH: 1000,
	ERR_EXPIRY_IN_PAST: 1001,
	ERR_SWAP_INTENT_ALREADY_EXISTS: 1002,
	ERR_UNKNOWN_SWAP_INTENT: 1003,
	ERR_SWAP_INTENT_EXPIRED: 1004,
	ERR_SWAP_INTENT_NOT_EXPIRED: 1005,
	ERR_INVALID_ASSET_CONTRACT: 1006,
	ERR_ASSET_CONTRACT_NOT_WHITELISTED: 1007,
	ERR_OWNER_ONLY: 1008
};

export function generate_secret(length: number = 64): Uint8Array {
	const buff = new Uint8Array(new ArrayBuffer(length));
	crypto.getRandomValues(buff);
	return buff;
}

export function calculate_hash(input: Uint8Array): Uint8Array {
	return new Uint8Array(createHash('sha256').update(input).digest());
}

export function typed_array_to_hex(input: Uint8Array): string {
	return input.reduce((hex: string, byte: number) => `${hex}${byte < 16 ? '0' : ''}${byte.toString(16)}`, '0x');
}

export function hex_to_typed_array(input: string): Uint8Array {
	input = input.substr(0, 2) === '0x' ? input.substr(2) : input;
	if (input.length % 2 || !/^[0-9a-fA-F]+$/.test(input))
		throw new Error(`Not a valid hex string: ${input} `);
	const buff = new Uint8Array(new ArrayBuffer(~~(input.length / 2)));
	for (let b = 0, i = 0; i < input.length; b++, i += 2)
		buff[b] = parseInt(input.substr(i, 2), 16);
	return buff;
}

export type SwapIntent = {
	hash: Uint8Array,
	expiration_height: number, // uintCV
	amount_or_token_id: number, // uintCV
	sender: string, // principalCV
	recipient: string, // principalCV
	asset_contract?: string // principalCV
	asset_type?: 'sip009' | 'sip010'
}

export function register_swap_intent(chain: Chain, swap_contract_principal: string, swap_intent: SwapIntent) {
	let functions_args = [types.buff(swap_intent.hash), types.uint(swap_intent.expiration_height), types.uint(swap_intent.amount_or_token_id), types.principal(swap_intent.recipient)];
	if (swap_intent.asset_contract)
		functions_args.push(types.principal(swap_intent.asset_contract));
	const block = chain.mineBlock([Tx.contractCall(swap_contract_principal, swap_intent.asset_contract ? `register-swap-intent-${swap_intent.asset_type || 'sip009'}` : 'register-swap-intent', functions_args, swap_intent.sender)]);
	return block.receipts[0] || false;
}

export function get_swap_intent(chain: Chain, swap_contract_principal: string, hash: Uint8Array, sender: string) {
	return chain.callReadOnlyFn(swap_contract_principal, 'get-swap-intent', [types.buff(hash), types.principal(sender)], sender);
}

export function cancel_swap_intent(chain: Chain, swap_contract_principal: string, swap_intent: SwapIntent, transaction_sender?: string) {
	let function_args = [types.buff(swap_intent.hash)];
	if (swap_intent.asset_contract)
		function_args.push(types.principal(swap_intent.asset_contract));
	const block = chain.mineBlock([Tx.contractCall(swap_contract_principal, swap_intent.asset_contract ? `cancel-swap-intent-${swap_intent.asset_type}` : 'cancel-swap-intent', function_args, transaction_sender || swap_intent.sender)]);
	return block.receipts[0] || false;
}

export function execute_swap(chain: Chain, swap_contract_principal: string, swap_intent: SwapIntent, preimage: Uint8Array, transaction_sender?: string) {
	let function_args = [types.principal(swap_intent.sender), types.buff(preimage)];
	if (swap_intent.asset_contract)
		function_args.push(types.principal(swap_intent.asset_contract));
	const block = chain.mineBlock([Tx.contractCall(swap_contract_principal, swap_intent.asset_contract ? `swap-${swap_intent.asset_type}` : 'swap', function_args, transaction_sender || swap_intent.recipient)]);
	return block.receipts[0] || false;
}

export function swap_contract_principal(deployer: Account, swap_intent: SwapIntent) {
	return `${deployer.address}.${swap_intent.asset_contract ? 'sip009-sip010-htlc' : 'stx-htlc'}`;
}

export function sip009_mint(chain: Chain, token_contract_principal: string, recipient: string) {
	const block = chain.mineBlock([Tx.contractCall(token_contract_principal, 'mint', [types.principal(recipient)], recipient)]);
	const event = block.receipts[0].events[0].nft_mint_event;
	return { ...event, token_id: parseInt(event.value.substr(1)) };
}

export function sip010_mint(chain: Chain, token_contract_principal: string, amount: number, recipient: string) {
	const block = chain.mineBlock([Tx.contractCall(token_contract_principal, 'mint', [types.uint(amount), types.principal(recipient)], recipient)]);
	return { ...block.receipts[0].events[0].ft_mint_event, amount };
}

export function sip009_sip010_htlc_set_whitelisted(chain: Chain, swap_contract_principal: string, list: { token_contract: string, whitelisted: boolean }[], sender: string) {
	const list_cv = types.list(list.map(({ token_contract, whitelisted }) => types.tuple({ 'asset-contract': types.principal(token_contract), whitelisted: types.bool(whitelisted) })));
	return chain.mineBlock([Tx.contractCall(swap_contract_principal, 'set-whitelisted', [list_cv], sender)]).receipts[0];
}