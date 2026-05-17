import { promises as fs } from 'fs';
import * as path from 'path';

/** Wraps a promise with a timeout — rejects with a labeled error if the promise doesn't resolve within `ms` milliseconds. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/** Returns the `.name` property of an Error object, or 'UnknownError' for non-Error values. */
export function getErrorCategory(error: unknown): string {
    if (error && typeof error === 'object' && 'name' in error && typeof (error as { name: unknown }).name === 'string') {
        return (error as { name: string }).name;
    }
    return 'UnknownError';
}

/** Extracts a human-readable message from an unknown error value. */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/** Computes the arithmetic mean of a number array. Returns 0 for empty arrays. */
export function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/** Checks whether the webview dist directory contains compiled JS and CSS assets. */
export async function webviewAssetsReady(extensionPath: string): Promise<boolean> {
    const webviewDistPath = path.join(extensionPath, 'dist', 'webview');
    const hasDistDir = await pathExists(webviewDistPath);
    if (!hasDistDir) return false;

    const entries = await fs.readdir(webviewDistPath);
    const hasJs = entries.some((entry) => entry.endsWith('.js'));
    const hasCss = entries.some((entry) => entry.endsWith('.css'));
    return hasJs && hasCss;
}
