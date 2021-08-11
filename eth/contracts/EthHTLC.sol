// SPDX-License-Identifier: MIT
// By Marvin Janssen

pragma solidity 0.8.6;

contract EthHTLC
	{
	struct SwapIntent
		{
		uint256 expiration_height;
		uint256 amount;
		address recipient;
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

	function register_swap_intent(bytes32 intent_hash, uint256 expiration_height, address recipient)
		public
		payable
		{
		require(msg.value > 0, "No value");
		require(block.number < expiration_height, "Expiry in the past");
		bytes32 key = swap_key(msg.sender, intent_hash);
		require(swap_intents[key].amount == 0, "Swap intent already exists");
		swap_intents[key] = SwapIntent({
			amount: msg.value,
			expiration_height: expiration_height,
			recipient: recipient
			});
		}

	function cancel_swap_intent(bytes32 intent_hash)
		public
		reentrancy_guard
		{
		bytes32 key = swap_key(msg.sender, intent_hash);
		require(swap_intents[key].amount > 0, "Unknown swap");
		require(block.number >= swap_intents[key].expiration_height, "Swap intent not expired");
		safe_transfer_value(msg.sender, swap_intents[key].amount);
		delete swap_intents[key];
		}

	function swap(address sender, bytes calldata preimage)
		public
		reentrancy_guard
		{
		require(preimage.length <= 64, "Preimage too large");
		bytes32 intent_hash = sha256(preimage);
		bytes32 key = swap_key(sender, intent_hash);
		require(swap_intents[key].amount > 0, "Unknown swap");
		require(block.number < swap_intents[key].expiration_height, "Swap intent expired");
		safe_transfer_value(swap_intents[key].recipient, swap_intents[key].amount);
		delete swap_intents[key];
		}

	function safe_transfer_value(address recipient, uint256 amount)
		private
		{
		(bool success,) = recipient.call{value: amount}("");
		require(success,"Transfer failed (call)");
		}
	}
