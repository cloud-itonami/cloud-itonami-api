import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('out/BusinessVault.sol/BusinessVault.json'));
fs.writeFileSync('src/vault-artifact.json',JSON.stringify({abi:a.abi,bytecode:a.bytecode.object,runtime:a.deployedBytecode.object,immutableReferences:a.deployedBytecode.immutableReferences}));

const y=JSON.parse(fs.readFileSync("out/YieldVault.sol/YieldVault.json"));
fs.writeFileSync("src/yield-vault-artifact.json",JSON.stringify({abi:y.abi,bytecode:y.bytecode.object,runtime:y.deployedBytecode.object,immutableReferences:y.deployedBytecode.immutableReferences}));

const l=JSON.parse(fs.readFileSync('out/BotFundingLauncher.sol/BotFundingLauncher.json'));
fs.writeFileSync('src/launcher-artifact.json',JSON.stringify({abi:l.abi,bytecode:l.bytecode.object,runtime:l.deployedBytecode.object,immutableReferences:l.deployedBytecode.immutableReferences}));
