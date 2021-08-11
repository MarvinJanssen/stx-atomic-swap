const EthHTLC = artifacts.require("EthHTLC");
const Erc20Erc721HTLC = artifacts.require("Erc20Erc721HTLC");

const TestERC20 = artifacts.require("TestERC20");
const TestERC721 = artifacts.require("TestERC721");

module.exports = async function (deployer, network)
	{
	if (network === 'development')
		await Promise.all([deployer.deploy(TestERC20), deployer.deploy(TestERC721)]);
	await Promise.all([deployer.deploy(EthHTLC), deployer.deploy(Erc20Erc721HTLC)]);
	};
