const spawn = require('child_process').spawn;
const readline = require('readline');
const Web3 = require('web3');
const fs = require('fs/promises');
const BN = require('bn.js');

const DEBUG = !!process.env.DEBUG;

async function start_eth_chain()
	{
	return new Promise((resolve,reject) =>
		{
		const child = spawn('npm run eth-test-rpc',{shell: true});
		DEBUG && child.stdout.on('data',chunk => console.debug(chunk.toString()));
		child.on('error',reject);
		child.on('exit',code => code > 0 && reject(`ETH process exited with ${code}. Set DEBUG=1 for more information.`));

		let deploy_contracts = () =>
			{
			return new Promise((resolve,reject) =>
				{
				const child = spawn('npm run eth-deploy',{shell: true});
				DEBUG && child.stdout.on('data',chunk => console.debug(chunk.toString()));
				child.on('exit',code => code === 0 ? resolve() : reject());
				});
			};

		let session_setup = async (web3) =>
			{
			const net_id = await web3.eth.net.getId();
			const eth_contracts_build_dir = process.env.ETH_CONTRACTS_BUILD_DIR || './eth/build/contracts';
			const dir = await fs.readdir(eth_contracts_build_dir);
			const accounts = await web3.eth.getAccounts();
			const contracts = {};
			for (const file of dir)
				{
				if (file.substr(-5) !== '.json')
					continue;
				const json = JSON.parse(await fs.readFile(`${eth_contracts_build_dir}/${file}`,'utf8'));
				if (!json.networks[net_id])
					continue;
				const address = json.networks[net_id].address;
				contracts[json.contractName] = new web3.eth.Contract(json.abi,address);
				contracts[json.contractName].defaultAccount = accounts[0];
				}
			return {contracts,accounts};
			};

		let rl = readline.createInterface({input: child.stdout, terminal: true});
		rl.on('line',line =>
			{
			let match;
			if (match = line.match(/^Listening on (.+)$/))
				{
				const address = match[1];
				const web3 = new Web3(new Web3.providers.HttpProvider(`http://${address}`));
				DEBUG && console.debug('Deploying ETH contracts...');
				deploy_contracts()
					.catch(() => {child.kill(); reject("ETH contract deployment failed")})
					.then(() => session_setup(web3))
					.then(session => resolve(
						{
						child,
						web3,
						block_height: async (increment) =>
							{
							const height = new BN(await web3.eth.getBlockNumber());
							return increment ? height.add(new BN(increment)) : height;
							},
						balance: async (address) => new BN(await web3.eth.getBalance(address)),
						session,
						kill: signal =>
							{
							rl.close();
							child.kill(signal);
							}
						}));
				}
			else
				DEBUG && console.debug(`ETH: ${line}`);
			});
		});
	}

	async function erc20_mint(eth_chain, recipient, amount)
	{
	const response = await eth_chain.session.contracts.TestERC20.methods.mint(recipient, amount).send({from: recipient});
	return {...response.events.Transfer.returnValues, asset_contract: eth_chain.session.contracts.TestERC20.options.address};
	}

async function erc20_approve_htlc(eth_chain, owner)
	{
	const max_int = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
	return eth_chain.session.contracts.TestERC20.methods.approve(eth_chain.session.contracts.Erc20Erc721HTLC.options.address, max_int).send({from: owner});
	}

async function erc20_balance(eth_chain, address)
	{
	return new BN(await eth_chain.session.contracts.TestERC20.methods.balanceOf(address).call());
	}

async function erc721_mint(eth_chain, recipient)
	{
	const response = await eth_chain.session.contracts.TestERC721.methods.mint(recipient).send({from: recipient});
	return {...response.events.Transfer.returnValues, asset_contract: eth_chain.session.contracts.TestERC721.options.address};
	}

async function erc721_approve_htlc(eth_chain, owner)
	{
	return eth_chain.session.contracts.TestERC721.methods.setApprovalForAll(eth_chain.session.contracts.Erc20Erc721HTLC.options.address, true).send({from: owner});
	}

async function erc721_owner(eth_chain, token_id)
	{
	return await eth_chain.session.contracts.TestERC721.methods.ownerOf(token_id).call();
	}

async function eth_register_swap_intent(options)
	{
	const {
		eth_chain, // object, ETH chain instance from start_eth_chain()
		contract_name,
		sender, // principal
		recipient, // principal
		hash, // buffer
		gas,
		amount_or_token_id, // BN, amount for ETH or ERC20, token ID for ERC721
		expiration_height, // BN, expiration block height
		asset_contract, // principal | null, null for ETH swap
		} = options;
	if (!eth_chain || !sender || !recipient || !hash || !amount_or_token_id || !expiration_height)
		throw new Error('Missing options');
	let contract = (contract_name && eth_chain.session.contracts[contract_name]) || (asset_contract ? eth_chain.session.contracts.Erc20Erc721HTLC : eth_chain.session.contracts.EthHTLC);
	if (asset_contract)
		return contract.methods.register_swap_intent(hash, expiration_height, recipient, asset_contract, amount_or_token_id).send({from: sender, gas: gas || 999999});
	return contract.methods.register_swap_intent(hash, expiration_height, recipient).send({value: amount_or_token_id, from: sender});
	}

async function eth_execute_swap(options)
	{
	const {
		eth_chain, // object, ETH chain instance from start_eth_chain()
		contract_name,
		sender, // address
		transaction_sender, // address
		preimage, // buffer,
		gas,
		asset_contract // bool / address
		} = options;
	if (!eth_chain || !sender || !preimage)
		throw new Error('Missing options');
	let contract = (contract_name && eth_chain.session.contracts[contract_name]) || (asset_contract ? eth_chain.session.contracts.Erc20Erc721HTLC : eth_chain.session.contracts.EthHTLC);
	return contract.methods.swap(sender, preimage).send({from: transaction_sender || sender, gas: gas || 999999});
	}

module.exports = {
	start_eth_chain,
	eth_register_swap_intent,
	eth_execute_swap,
	erc20_mint,
	erc20_approve_htlc,
	erc20_balance,
	erc721_mint,
	erc721_approve_htlc,
	erc721_owner
};
	