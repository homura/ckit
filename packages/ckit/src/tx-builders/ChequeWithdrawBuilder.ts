import { Address, utils, since, Cell } from '@ckb-lumos/base';
import { SearchKey } from '@ckitjs/mercury-client';
import { Amount, Builder, RawTransaction, Transaction, CellInput } from '@lay2/pw-core';
import { CkbTypeScript, CkitProvider } from '..';
import { AbstractPwSenderBuilder } from './pw/AbstractPwSenderBuilder';
import { byteLenOfHexData, byteLenOfLockOnlyCell, mergeLockOnlyCells } from './builder-utils';
import { Pw } from '../helpers/pw';
import { BN } from '../helpers';
import { bytes } from '@ckitjs/utils';
import { minimalCellCapacity } from '@ckb-lumos/helpers';

export interface ChequeWithdrawOptions {
  sender: Address;
  receiver: Address;
  sudt?: CkbTypeScript;
}

export class ChequeWithdrawBuilder extends AbstractPwSenderBuilder {
  constructor(private options: ChequeWithdrawOptions, provider: CkitProvider) {
    super(provider);
  }

  async build(): Promise<Transaction> {
    const { sender, receiver, sudt } = this.options;
    const provider = this.provider;

    const senderLock = this.provider.parseToScript(sender);
    const receiverLock = this.provider.parseToScript(receiver);

    const searchKey: SearchKey = {
      script: this.provider.newScript(
        'CHEQUE',
        `0x${utils.computeScriptHash(receiverLock).slice(2, 42)}${utils.computeScriptHash(senderLock).slice(2, 42)}`,
      ),
      ...(sudt ? { filter: { script: sudt } } : {}),
      script_type: 'lock',
    };
    const unwithdrawnCells = await this.provider.collectCells({ searchKey }, (cells) => cells.length <= 1000);

    let withdrawnChangeCapacity = BN(0);
    let extraNeededCapacity = BN(0);
    const withdrawnSudtCells = unwithdrawnCells.map(function (cell) {
      const sudtCell = { ...cell, cell_output: { ...cell.cell_output, lock: senderLock } };
      const sudtCapacity = bytes.toHex(minimalCellCapacity(sudtCell));

      withdrawnChangeCapacity = withdrawnChangeCapacity.plus(BN(cell.cell_output.capacity).minus(sudtCapacity));

      return { ...cell, cell_output: { ...cell.cell_output, lock: senderLock, capacity: sudtCapacity } };
    });
    const withdrawnChangeCell: Cell = {
      data: '0x',
      cell_output: {
        capacity: '0x0',
        lock: senderLock,
        type: undefined,
      },
    };
    const minimalCapacity = minimalCellCapacity(withdrawnChangeCell);
    if (withdrawnChangeCapacity.toNumber() < minimalCapacity) {
      withdrawnChangeCell.cell_output.capacity = bytes.toHex(minimalCapacity);
      extraNeededCapacity = extraNeededCapacity.plus(BN(minimalCapacity).minus(withdrawnChangeCapacity));
    } else {
      withdrawnChangeCell.cell_output.capacity = bytes.toHex(withdrawnChangeCapacity);
    }

    const inputCapacityCells = await this.provider.collectLockOnlyCells(
      senderLock,
      new Amount(bytes.toHex(extraNeededCapacity), 0)
        .add(new Amount('1'))
        .add(new Amount(byteLenOfLockOnlyCell(byteLenOfHexData(receiverLock.args)).toString()))
        .toHexString(),
    );

    const changeCell = Pw.toPwCell(mergeLockOnlyCells(inputCapacityCells));

    const inputSince = since.generateSince({
      relative: true,
      type: 'epochNumber',
      value: {
        number: 6,
        length: 0,
        index: 0,
      },
    });

    const rawTx = new RawTransaction(
      [...inputCapacityCells.map(Pw.toPwCell), ...unwithdrawnCells.map(Pw.toPwCell)],
      [...withdrawnSudtCells.map(Pw.toPwCell), Pw.toPwCell(withdrawnChangeCell), changeCell],

      this.getCellDepsByCells(
        [...inputCapacityCells.map(Pw.toPwCell), ...unwithdrawnCells.map(Pw.toPwCell)],
        [...withdrawnSudtCells.map(Pw.toPwCell), Pw.toPwCell(withdrawnChangeCell), changeCell],
      ),
    );
    rawTx.inputs = rawTx.inputCells.map<CellInput>(function (cell) {
      const cellInput = cell.toCellInput()!;
      const script = {
        code_hash: cell.lock.codeHash,
        hash_type: cell.lock.hashType,
        args: cell.lock.args,
      };
      if (provider.isTemplateOf('CHEQUE', script)) {
        return new CellInput(cellInput.previousOutput, inputSince);
      } else {
        return new CellInput(cellInput.previousOutput, '0x0');
      }
    });

    const tx = new Transaction(rawTx, [this.getWitnessPlaceholder(sender)]);

    const fee = Builder.calcFee(tx, Number(this.provider.config.MIN_FEE_RATE));
    changeCell.capacity = changeCell.capacity.sub(fee).sub(new Amount(bytes.toHex(extraNeededCapacity), 0));

    return tx;
  }
}
