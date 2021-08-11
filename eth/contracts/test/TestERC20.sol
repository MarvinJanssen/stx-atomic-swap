// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20("TestERC20", "TE20")
	{
	constructor() {}

	function mint(address to, uint256 value) public returns (bool)
		{
		_mint(to, value);
		return true;
		}
	}

