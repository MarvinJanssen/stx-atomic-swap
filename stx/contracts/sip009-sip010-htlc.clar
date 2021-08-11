;; SIP009 (FT) & SIP010 (NFT) Hashed Timelock Contract (HTLC)
;; By Marvin Janssen

(define-constant err-invalid-hash-length (err u1000))
(define-constant err-expiry-in-past (err u1001))
(define-constant err-swap-intent-already-exists (err u1002))
(define-constant err-unknown-swap-intent (err u1003))
(define-constant err-swap-intent-expired (err u1004))
(define-constant err-swap-intent-not-expired (err u1005))
(define-constant err-invalid-asset-contract (err u1006))

(define-trait sip009-sip010-transferable
	(
		(transfer (uint principal principal) (response bool uint))
	)
)

(define-map swap-intents {sender: principal, hash: (buff 32)} {expiration-height: uint, amount-or-token-id: uint, recipient: principal, asset-contract: principal})

(define-read-only (get-swap-intent (hash (buff 32)) (sender principal))
	(map-get? swap-intents {sender: sender, hash: hash})
)

(define-public (register-swap-intent (hash (buff 32)) (expiration-height uint) (amount-or-token-id uint) (recipient principal) (asset-contract <sip009-sip010-transferable>))
	(begin
		(asserts! (is-eq (len hash) u32) err-invalid-hash-length)
		(asserts! (< block-height expiration-height) err-expiry-in-past)
		(asserts! (map-insert swap-intents {sender: tx-sender, hash: hash} {expiration-height: expiration-height, amount-or-token-id: amount-or-token-id, recipient: recipient, asset-contract: (contract-of asset-contract)}) err-swap-intent-already-exists)
		(try! (contract-call? asset-contract transfer amount-or-token-id tx-sender (as-contract tx-sender)))
		(ok true)
	)
)

(define-public (cancel-swap-intent (hash (buff 32)) (asset-contract <sip009-sip010-transferable>))
	(let
		(
			(swap-intent (unwrap! (get-swap-intent hash tx-sender) err-unknown-swap-intent))
			(sender tx-sender)
		)
		(asserts! (is-eq (get asset-contract swap-intent) (contract-of asset-contract)) err-invalid-asset-contract)
		(asserts! (>= block-height (get expiration-height swap-intent)) err-swap-intent-not-expired)
		(try! (as-contract (contract-call? asset-contract transfer (get amount-or-token-id swap-intent) tx-sender sender)))
		(map-delete swap-intents {sender: tx-sender, hash: hash})
		(ok true)
	)
)

(define-public (swap (sender principal) (preimage (buff 64)) (asset-contract <sip009-sip010-transferable>))
	(let
		(
			(hash (sha256 preimage))
			(swap-intent (unwrap! (get-swap-intent hash sender) err-unknown-swap-intent))
		)
		(asserts! (is-eq (get asset-contract swap-intent) (contract-of asset-contract)) err-invalid-asset-contract)
		(asserts! (< block-height (get expiration-height swap-intent)) err-swap-intent-expired)
		(try! (as-contract (contract-call? asset-contract transfer (get amount-or-token-id swap-intent) tx-sender (get recipient swap-intent))))
		(map-delete swap-intents {sender: sender, hash: hash})
		(ok true)
	)
)
