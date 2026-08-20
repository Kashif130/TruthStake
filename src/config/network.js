import dotenv from 'dotenv';

dotenv.config();

export const bradburyNetwork = {
    chainIdHex: '0x107D',
    chainName: 'GenLayer Bradbury',
    rpcUrls: ('https://rpc.testnet-chain.genlayer.com').split(','),
    nativeCurrency: {
        name: process.env.NATIVE_CURRENCY_NAME || 'GEN',
        symbol: process.env.NATIVE_CURRENCY_SYMBOL || 'GEN',
        decimals: 18,
    },
    blockExplorerUrls: ('https://explorer.testnet-chain.genlayer.com').split(','),
};

export const studionetNetwork = {
    chainIdHex: '0xF22F',
    chainName: 'GenLayer StudioNet',
    rpcUrls: ('https://studio.genlayer.com/api').split(','),
    nativeCurrency: {
        name: process.env.NATIVE_CURRENCY_NAME || 'GEN',
        symbol: process.env.NATIVE_CURRENCY_SYMBOL || 'GEN',
        decimals: 18,
    },
    blockExplorerUrls: ('').split(','),
};

export function getPrivateKey() {
    return process.env.PRIVATE_KEY || "";
}

export function getRegistryBradbury() {
    return process.env.IC_REGISTRY || "";
}

export function getRegistryStudioNet() {
    return process.env.IC_REGISTRY_STUDIO_NET || "";
}
