// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestERC721 is ERC721("TestERC721", "TE721")
	{
	constructor() {}

	uint256 private last_token_id = 0;

	function mint(address to) public returns (bool)
		{
		_mint(to, last_token_id++);
		return true;
		}
	}
