"use client";

import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseAbi } from "viem";
import { useState, useCallback } from "react";

// Polymarket contracts on Polygon
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const;
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

const ctfAbi = parseAbi([
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
]);

const negRiskAbi = parseAbi([
  "function redeemPositions(bytes32 conditionId, uint256[] amounts) external",
]);

export interface RedeemArgs {
  conditionId: `0x${string}`;
  negativeRisk: boolean;
  outcomeIndex: number; // 0=YES, 1=NO
  amountAtoms: bigint;  // balance in atoms (6 decimals) to burn
}

/**
 * Client-side redeem via connected wallet. Caller's wallet signs the tx.
 * For negRisk markets: NegRiskAdapter.redeemPositions(conditionId, [yesAmt, noAmt])
 * For regular markets: CTF.redeemPositions(USDC, ZERO, conditionId, [indexSet])
 */
export function useRedeem() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const [localError, setLocalError] = useState<string | null>(null);

  const redeem = useCallback(async (args: RedeemArgs): Promise<`0x${string}` | null> => {
    setLocalError(null);
    try {
      if (args.negativeRisk) {
        const amounts: [bigint, bigint] = args.outcomeIndex === 0
          ? [args.amountAtoms, BigInt(0)]
          : [BigInt(0), args.amountAtoms];

        return await writeContractAsync({
          address: NEG_RISK_ADAPTER,
          abi: negRiskAbi,
          functionName: "redeemPositions",
          args: [args.conditionId, amounts],
        });
      } else {
        const indexSet = BigInt(1) << BigInt(args.outcomeIndex);
        return await writeContractAsync({
          address: CTF,
          abi: ctfAbi,
          functionName: "redeemPositions",
          args: [USDC_E, ZERO, args.conditionId, [indexSet]],
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      setLocalError(msg);
      return null;
    }
  }, [writeContractAsync]);

  return {
    redeem,
    hash,
    isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    error: localError || (error ? error.message.slice(0, 200) : null),
  };
}
