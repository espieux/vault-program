/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/vault_program.json`.
 */
export type VaultProgram = {
  "address": "D7KrGPhkyWsqMRS7kQjaGzyT48nTaw4AopWM6qXXmBtg",
  "metadata": {
    "name": "vaultProgram",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "claimWithdraw",
      "docs": [
        "Claim withdrawal by transferring deposit tokens from vault to user.",
        "",
        "Parameters:",
        "- None (uses withdrawal ticket data)",
        "",
        "Security assumptions:",
        "- Withdrawal ticket must exist and belong to the user",
        "- Ticket must not be already claimed",
        "- Current epoch must be >= unlock_epoch",
        "- Vault must have sufficient deposit tokens"
      ],
      "discriminator": [
        232,
        89,
        154,
        117,
        16,
        204,
        182,
        224
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The user claiming the withdrawal (must sign)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
          "docs": [
            "The vault state PDA"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.deposit_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "depositMint",
          "docs": [
            "The deposit token mint"
          ],
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultDepositTokenAccount",
          "docs": [
            "Vault's deposit token account (source of transfer, owned by vault_state PDA)"
          ],
          "writable": true
        },
        {
          "name": "userDepositTokenAccount",
          "docs": [
            "User's deposit token account (destination of transfer)"
          ],
          "writable": true
        },
        {
          "name": "withdrawalTicket",
          "docs": [
            "Withdrawal ticket PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "vaultState"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program for transfers"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "Deposit tokens into the vault and receive IOU tokens based on the current exchange rate.",
        "",
        "Parameters:",
        "- deposit_amount: Amount of deposit tokens to transfer to the vault",
        "",
        "Security assumptions:",
        "- VaultState must be initialized",
        "- User must have sufficient deposit tokens",
        "- Exchange rate must be set (non-zero)"
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The user making the deposit (must sign)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
          "docs": [
            "The vault state PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.deposit_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "depositMint",
          "docs": [
            "The deposit token mint"
          ],
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "iouMint",
          "docs": [
            "The IOU token mint"
          ],
          "writable": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "userDepositTokenAccount",
          "docs": [
            "User's deposit token account (source of transfer)"
          ],
          "writable": true
        },
        {
          "name": "vaultDepositTokenAccount",
          "docs": [
            "Vault's deposit token account (destination of transfer)"
          ],
          "writable": true
        },
        {
          "name": "userIouTokenAccount",
          "docs": [
            "User's IOU token account (destination of mint)"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program for transfers and mints"
          ]
        }
      ],
      "args": [
        {
          "name": "depositAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositYield",
      "docs": [
        "Deposit yield tokens into the vault (admin-only).",
        "This represents staking rewards, yield, or other income that benefits existing holders.",
        "No IOU tokens are minted - the yield increases the value of existing IOUs.",
        "",
        "Parameters:",
        "- yield_amount: Amount of deposit tokens to transfer to the vault",
        "",
        "Security assumptions:",
        "- Only the admin can call this instruction",
        "- Admin must have sufficient deposit tokens",
        "- VaultState must be initialized"
      ],
      "discriminator": [
        204,
        126,
        164,
        36,
        57,
        174,
        68,
        139
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The admin authority (must sign and match vault_state.admin)"
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultState",
          "docs": [
            "The vault state PDA"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.deposit_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "depositMint",
          "docs": [
            "The deposit token mint"
          ]
        },
        {
          "name": "adminDepositTokenAccount",
          "docs": [
            "Admin's deposit token account (source of transfer)"
          ],
          "writable": true
        },
        {
          "name": "vaultDepositTokenAccount",
          "docs": [
            "Vault's deposit token account (destination of transfer, owned by vault_state PDA)"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program for transfers"
          ]
        }
      ],
      "args": [
        {
          "name": "yieldAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "increaseRate",
      "docs": [
        "Increase the exchange rate to simulate yield growth (admin-only).",
        "",
        "Parameters:",
        "- new_exchange_rate: New exchange rate value (scaled by EXCHANGE_RATE_SCALE)",
        "",
        "Security assumptions:",
        "- Only the admin can call this instruction",
        "- New exchange rate must be greater than zero",
        "- Exchange rate should typically increase to simulate yield"
      ],
      "discriminator": [
        107,
        159,
        17,
        45,
        214,
        117,
        54,
        254
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The admin authority (must sign and match vault_state.admin)"
          ],
          "signer": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "vaultState",
          "docs": [
            "The vault state PDA (mutable to update exchange_rate and current_epoch)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.deposit_mint",
                "account": "vaultState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newExchangeRate",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Initialize the vault with admin, deposit mint, and IOU mint.",
        "",
        "Parameters:",
        "- None (all data comes from accounts)",
        "",
        "Security assumptions:",
        "- Admin must sign the transaction",
        "- VaultState must not already exist (enforced by init constraint)",
        "- Deposit mint and IOU mint must be valid token mints"
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The admin authority that will control the vault (must sign and pay for account creation)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
          "docs": [
            "The vault state PDA",
            "Seeds: [\"vault_state\", deposit_mint]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "depositMint"
              }
            ]
          }
        },
        {
          "name": "depositMint",
          "docs": [
            "The deposit token mint (used in PDA seeds)"
          ]
        },
        {
          "name": "iouMint",
          "docs": [
            "The IOU token mint (stored in VaultState)"
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program for account creation"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "requestWithdraw",
      "docs": [
        "Request withdrawal by burning IOU tokens and creating a withdrawal ticket.",
        "",
        "Parameters:",
        "- iou_amount: Amount of IOU tokens to burn for withdrawal",
        "",
        "Security assumptions:",
        "- User must have sufficient IOU tokens",
        "- User must not have an existing unclaimed withdrawal ticket",
        "- VaultState must be initialized"
      ],
      "discriminator": [
        137,
        95,
        187,
        96,
        250,
        138,
        31,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The user requesting withdrawal (must sign)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
          "docs": [
            "The vault state PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault_state.deposit_mint",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "iouMint",
          "docs": [
            "The IOU token mint"
          ],
          "writable": true,
          "relations": [
            "vaultState"
          ]
        },
        {
          "name": "userIouTokenAccount",
          "docs": [
            "User's IOU token account (source of burn)"
          ],
          "writable": true
        },
        {
          "name": "withdrawalTicket",
          "docs": [
            "Withdrawal ticket PDA (one per user per vault)",
            "Space: 8 (discriminator) + 32 (user) + 8 (iou_amount) + 8 (unlock_epoch) + 1 (claimed) = 57"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108,
                  95,
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "vaultState"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program for burns"
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program for account creation"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "iouAmount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "vaultState",
      "discriminator": [
        228,
        196,
        82,
        165,
        98,
        210,
        235,
        152
      ]
    },
    {
      "name": "withdrawalTicket",
      "discriminator": [
        92,
        140,
        181,
        69,
        244,
        220,
        233,
        156
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidExchangeRate",
      "msg": "Invalid exchange rate"
    },
    {
      "code": 6001,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6002,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6003,
      "name": "ticketAlreadyClaimed",
      "msg": "Withdrawal ticket already claimed"
    },
    {
      "code": 6004,
      "name": "invalidTicketOwner",
      "msg": "Invalid ticket owner"
    },
    {
      "code": 6005,
      "name": "withdrawalNotReady",
      "msg": "Withdrawal not ready - unlock epoch not reached"
    },
    {
      "code": 6006,
      "name": "unauthorizedAdmin",
      "msg": "Unauthorized - only admin can perform this action"
    },
    {
      "code": 6007,
      "name": "insufficientVaultBalance",
      "msg": "Insufficient vault balance - vault does not have enough tokens to fulfill withdrawal"
    }
  ],
  "types": [
    {
      "name": "vaultState",
      "docs": [
        "VaultState stores the global vault configuration and state.",
        "This is a PDA derived from the deposit_mint to ensure one vault per deposit token type."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Admin authority that can update exchange rate"
            ],
            "type": "pubkey"
          },
          {
            "name": "depositMint",
            "docs": [
              "The mint of tokens that can be deposited into the vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "iouMint",
            "docs": [
              "The mint of IOU tokens representing shares in the vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "exchangeRate",
            "docs": [
              "Exchange rate: iou_amount = deposit_amount * EXCHANGE_RATE_SCALE / exchange_rate",
              "When exchange_rate increases, IOU becomes more valuable (yield-bearing behavior)",
              "Scaled by EXCHANGE_RATE_SCALE (1_000_000) for precision",
              "Example: exchange_rate = 1_100_000 means 1 IOU = 1.1 tokens"
            ],
            "type": "u64"
          },
          {
            "name": "currentEpoch",
            "docs": [
              "Current epoch number (incremented by admin via increase_rate)"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawalTicket",
      "docs": [
        "WithdrawalTicket represents a pending withdrawal request.",
        "Users must wait until unlock_epoch before claiming their withdrawal."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "The user who requested the withdrawal"
            ],
            "type": "pubkey"
          },
          {
            "name": "iouAmount",
            "docs": [
              "Amount of IOU tokens that were burned for this withdrawal"
            ],
            "type": "u64"
          },
          {
            "name": "unlockEpoch",
            "docs": [
              "Epoch when the withdrawal can be claimed (current_epoch + 1 when created)"
            ],
            "type": "u64"
          },
          {
            "name": "claimed",
            "docs": [
              "Whether this withdrawal has been claimed"
            ],
            "type": "bool"
          }
        ]
      }
    }
  ]
};
