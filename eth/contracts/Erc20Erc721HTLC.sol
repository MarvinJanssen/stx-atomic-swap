// SPDX-License-Identifier: MIT
// By Marvin Janssen, h

pragma solidity 0.8.6;

contract Erc20Erc721HTLC
	{
	bytes4 private constant TRANSFER_FROM_SELECTOR = bytes4(keccak256("transferFrom(address,address,uint256)"));
	bytes4 private constant TRANSFER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

	struct SwapIntent
		{
		uint256 expiration_height;
		uint256 amount_or_token_id;
		address recipient;
		address asset_contract;
		}
	mapping(bytes32 => SwapIntent) swap_intents;

	uint256 private constant REENTRANCY_NOT_ENTERED = 1;
	uint256 private constant REENTRANCY_ENTERED = 2;
	uint256 private reentrancy_state = REENTRANCY_NOT_ENTERED;

	modifier reentrancy_guard()
		{
		require(reentrancy_state != REENTRANCY_ENTERED,"Reentrancy");
		reentrancy_state = REENTRANCY_ENTERED;
		_;
		reentrancy_state = REENTRANCY_NOT_ENTERED;
		}

	function swap_key(address sender, bytes32 intent_hash)
		private
		pure
		returns (bytes32)
		{
		return keccak256(abi.encodePacked(sender, intent_hash));
		}

	function get_swap_intent(bytes32 intent_hash, address sender)
		public
		view
		returns (SwapIntent memory)
		{
		return swap_intents[swap_key(sender, intent_hash)];
		}

	function register_swap_intent(bytes32 intent_hash, uint256 expiration_height, address recipient, address asset_contract, uint256 amount_or_token_id)
		public
		reentrancy_guard
		{
		require(block.number < expiration_height, "Expiry in the past");
		bytes32 key = swap_key(msg.sender, intent_hash);
		require(swap_intents[key].recipient == address(0x0), "Swap intent already exists");
		safe_transfer_from(asset_contract, msg.sender, address(this), amount_or_token_id);
		swap_intents[key] = SwapIntent({
			amount_or_token_id: amount_or_token_id,
			expiration_height: expiration_height,
			recipient: recipient,
			asset_contract: asset_contract
			});
		}

	function cancel_swap_intent(bytes32 intent_hash)
		public
		reentrancy_guard
		{
		bytes32 key = swap_key(msg.sender, intent_hash);
		require(swap_intents[key].recipient != address(0x0), "Unknown swap");
		require(block.number >= swap_intents[key].expiration_height, "Swap intent not expired");
		safe_transfer_from(swap_intents[key].asset_contract, address(this), msg.sender, swap_intents[key].amount_or_token_id);
		delete swap_intents[key];
		}

	function swap(address sender, bytes calldata preimage)
		public
		reentrancy_guard
		{
		require(preimage.length <= 64, "Preimage too large");
		bytes32 intent_hash = sha256(preimage);
		bytes32 key = swap_key(sender, intent_hash);
		require(swap_intents[key].recipient != address(0x0), "Unknown swap");
		require(block.number < swap_intents[key].expiration_height, "Swap intent expired");
		safe_transfer_from(swap_intents[key].asset_contract, address(this), swap_intents[key].recipient, swap_intents[key].amount_or_token_id);
		delete swap_intents[key];
		}

	function safe_transfer_from(address asset_contract, address from, address to, uint256 amount_or_token_id)
		private
		{
		bool success;
		bytes memory data;
		(success, data) = asset_contract.call(abi.encodeWithSelector(TRANSFER_FROM_SELECTOR, from, to, amount_or_token_id));
		if (!success) // Not optimal. If transferFrom fails then it must be an ERC20. Sadly, transferFrom does not work when sender is equal to msg.sender.
			(success, data) = asset_contract.call(abi.encodeWithSelector(TRANSFER_SELECTOR, to, amount_or_token_id));
		require(success, "Transfer failed (function call)");
		if (data.length > 0)
			require(abi.decode(data, (bool)), "Transfer failed (false returned)");
		}
	}
