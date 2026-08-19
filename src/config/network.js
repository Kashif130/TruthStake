import dotenv from 'dotenv';

dotenv.config();

export const bradburyNetwork = {
    chainIdHex: '0x107D',
    chainName: 'GenLayer Bradbury',
    rpcUrls: ('https://zksync-os-testnet-genlayer.zksync.dev').split(','),
    nativeCurrency: {
        name: process.env.NATIVE_CURRENCY_NAME || 'GEN',
        symbol: process.env.NATIVE_CURRENCY_SYMBOL || 'GEN',
        decimals: 18,
    },
    blockExplorerUrls: ('http://explorer-bradbury.genlayer.com/,https://zksync-os-testnet-genlayer.explorer.zksync.dev/').split(','),
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
