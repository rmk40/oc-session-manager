// SDK management

let createOpencodeClientInternal: any = null

export async function initSdk(): Promise<boolean> {
  try {
    const sdk = await import('@opencode-ai/sdk')
    createOpencodeClientInternal = sdk.createOpencodeClient
    return true
  } catch {
    return false
  }
}

export function getOpencodeClient(baseUrl: string): any {
  if (!createOpencodeClientInternal) return null
  return createOpencodeClientInternal({ baseUrl })
}

export function isSdkAvailable(): boolean {
  return createOpencodeClientInternal !== null
}
