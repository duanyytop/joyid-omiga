import { addressToScript, blake160, serializeScript, serializeWitnessArgs } from '@nervosnetwork/ckb-sdk-utils'
import { FEE, getJoyIDCellDep, getInscriptionInfoTypeScript, getCotaTypeScript, getXudtDep } from '../constants'
import { Hex, SubkeyUnlockReq, TransferParams } from '../types'
import { calcXudtTypeScript } from './helper'
import { append0x } from '../utils'

export const buildTransferTx = async ({
  collector,
  aggregator,
  address,
  inscriptionId,
  connectData,
  cellCount,
  toAddress,
  fee,
}: TransferParams): Promise<CKBComponents.RawTransaction> => {
  const txFee = fee ?? FEE
  const isMainnet = address.startsWith('ckb')
  const infoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }
  const xudtType = calcXudtTypeScript(infoType, isMainnet)
  const lock = addressToScript(address)
  const xudtCells = await collector.getCells({ lock, type: xudtType })
  if (xudtCells.length === 0) {
    throw new Error('The address has no xudt cells')
  }

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  if (cellCount && cellCount > 1) {
    const count = Math.min(cellCount, xudtCells.length)
    for (let index = 0; index < count; index++) {
      inputs.push({ previousOutput: xudtCells[index].outPoint, since: '0x0' })
      outputs.push({
        ...xudtCells[index].output,
        lock: addressToScript(toAddress),
      })
      outputsData.push(xudtCells[index].outputData)
    }
  } else {
    inputs.push({ previousOutput: xudtCells[0].outPoint, since: '0x0' })
    outputs.push({
      ...xudtCells[0].output,
      lock: addressToScript(toAddress),
    })
    outputsData.push(xudtCells[0].outputData)
  }
  outputs[0].capacity = append0x((BigInt(append0x(outputs[0].capacity)) - txFee).toString(16))

  let cellDeps = [getJoyIDCellDep(isMainnet), getXudtDep(isMainnet)]

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness)]
  if (connectData.keyType === 'sub_key') {
    const pubkeyHash = append0x(blake160(append0x(connectData.pubkey), 'hex'))
    const req: SubkeyUnlockReq = {
      lockScript: serializeScript(lock),
      pubkeyHash,
      algIndex: 1, // secp256r1
    }
    const { unlockEntry } = await aggregator.generateSubkeyUnlockSmt(req)
    const emptyWitness = {
      lock: '',
      inputType: '',
      outputType: append0x(unlockEntry),
    }
    witnesses[0] = serializeWitnessArgs(emptyWitness)

    const cotaType = getCotaTypeScript(isMainnet)
    const cotaCells = await collector.getCells({ lock, type: cotaType })
    if (!cotaCells || cotaCells.length === 0) {
      throw new Error("Cota cell doesn't exist")
    }
    const cotaCell = cotaCells[0]
    const cotaCellDep: CKBComponents.CellDep = {
      outPoint: cotaCell.outPoint,
      depType: 'code',
    }
    cellDeps = [cotaCellDep, ...cellDeps]
  }
  const rawTx: CKBComponents.RawTransaction = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    outputsData,
    witnesses,
  }

  return rawTx
}
