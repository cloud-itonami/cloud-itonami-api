import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('out/BusinessVault.sol/BusinessVault.json'));
fs.writeFileSync('src/vault-artifact.json',JSON.stringify({abi:a.abi,bytecode:a.bytecode.object,runtime:a.deployedBytecode.object,immutableReferences:a.deployedBytecode.immutableReferences}));
