import { AbstractWallet, ConnectStatus, Signer } from 'ckit';
import { autorun, runInAction } from 'mobx';
import { useLocalObservable } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createContainer } from 'unstated-next';
import { CkitProviderContainer } from '../CkitProviderContainer';
import { ObservableNonAcpPwLockWallet, ObservableUnipassWallet } from 'wallets';

export type CurrentWalletIndex = number | null;

export interface WalletConnectError {
  error: Error;
  index: number;
}

function useWallet() {
  const ckitProvider = CkitProviderContainer.useContainer();

  const wallets = useLocalObservable<AbstractWallet[]>(() => [new ObservableUnipassWallet() as AbstractWallet]);
  const [currentWalletIndex, setCurrentWalletIndex] = useState<CurrentWalletIndex>(null);
  const [error, setError] = useState<WalletConnectError | null>(null);
  const [visible, setVisible] = useState(false);

  const setModalVisible = useCallback((visible: boolean) => {
    setVisible(visible);
    setError(null);
  }, []);

  const selectedWallet = useMemo(
    () => (currentWalletIndex === null ? undefined : wallets[currentWalletIndex]),
    [currentWalletIndex, wallets],
  );

  useEffect(() => {
    if (!ckitProvider) return;
    runInAction(() => wallets.push(new ObservableNonAcpPwLockWallet(ckitProvider)));
  }, [ckitProvider, wallets]);

  useEffect(
    () =>
      autorun(() => {
        if (!wallets) return;
        wallets.forEach((wallet, index) => {
          const onConnectStatusChanged = (connectStatus: ConnectStatus) => {
            if (connectStatus === 'disconnected') {
              const connectedIndex = wallets.findIndex((w) => w.connectStatus === 'connected');
              if (-1 === connectedIndex) {
                setCurrentWalletIndex(null);
              } else {
                setCurrentWalletIndex(connectedIndex);
              }
            }
            if (connectStatus === 'connected') {
              setModalVisible(false);
              const connectedIndex = wallets.findIndex((w) => w.descriptor.name === wallet.descriptor.name);
              if (-1 === connectedIndex) {
                throw new Error('exception: wallet could not be found');
              } else {
                setCurrentWalletIndex(connectedIndex);
              }
            }
          };
          wallet.on('connectStatusChanged', onConnectStatusChanged);
          wallet.on('error', (err) =>
            setError({
              error: err as Error,
              index: index,
            }),
          );
        });
      }),
    [setModalVisible, wallets],
  );

  return {
    currentWalletIndex,
    setCurrentWalletIndex,
    wallets,
    selectedWallet,
    error,
    setError,
    visible,
    setModalVisible,
  };
}

interface SignerAddress {
  address: string | undefined;
}

export function useSigner(signer: Signer | undefined): SignerAddress {
  const [address, setAddress] = useState<string>();

  useEffect(() => {
    setAddress(undefined);
    if (!signer) return;
    void signer.getAddress().then(setAddress);
  }, [signer]);

  return { address };
}

export const WalletContainer = createContainer(useWallet);

export const displayWalletName = (name: string | undefined): string => {
  return name || 'unknown';
};
