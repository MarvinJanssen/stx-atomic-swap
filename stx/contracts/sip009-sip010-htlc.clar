;; SIP009 (FT) & SIP010 (NFT) Hashed Timelock Contract (HTLC)
;; By Marvin Janssen

(define-constant contract-owner tx-sender)

(define-constant err-invalid-hash-length (err u1000))
(define-constant err-expiry-in-past (err u1001))
(define-constant err-swap-intent-already-exists (err u1002))
(define-constant err-unknown-swap-intent (err u1003))
(define-constant err-swap-intent-expired (err u1004))
(define-constant err-swap-intent-not-expired (err u1005))
(define-constant err-invalid-asset-contract (err u1006))
(define-constant err-asset-contract-not-whitelisted (err u1007))
(define-constant err-owner-only (err u1008))

(define-trait sip009-transfer-trait
	(
		(transfer (uint principal principal) (response bool uint))
	)
)

(define-trait sip010-transfer-trait
	(
		(transfer (uint principal principal (optional (buff 34))) (response bool uint))
	)
)

(define-map token-contract-whitelist principal bool)
(define-map swap-intents {sender: principal, hash: (buff 32)} {expiration-height: uint, amount-or-token-id: uint, recipient: principal, asset-contract: principal})

(define-read-only (is-whitelisted (who principal))
	(default-to false (map-get? token-contract-whitelist who))
)

(define-private (set-whitelisted-iter (item {asset-contract: principal, whitelisted: bool}) (previous bool))
	(if (get whitelisted item) (map-set token-contract-whitelist (get asset-contract item) true) (map-delete token-contract-whitelist (get asset-contract item)))
)

(define-public (set-whitelisted (asset-contracts (list 200 {asset-contract: principal, whitelisted: bool})))
	(begin
		(asserts! (is-eq tx-sender contract-owner) err-owner-only)
		(ok (fold set-whitelisted-iter asset-contracts true))
	)
)

(define-read-only (get-swap-intent (hash (buff 32)) (sender principal))
	(map-get? swap-intents {sender: sender, hash: hash})
)

(define-private (register-swap-intent (hash (buff 32)) (expiration-height uint) (amount-or-token-id uint) (recipient principal) (asset-contract principal))
	(begin
		(asserts! (is-eq (len hash) u32) err-invalid-hash-length)
		(asserts! (< block-height expiration-height) err-expiry-in-past)
		(asserts! (is-some (map-get? token-contract-whitelist asset-contract)) err-asset-contract-not-whitelisted)
		(asserts! (map-insert swap-intents {sender: tx-sender, hash: hash} {expiration-height: expiration-height, amount-or-token-id: amount-or-token-id, recipient: recipient, asset-contract: asset-contract}) err-swap-intent-already-exists)
		(ok true)
	)
)

(define-public (register-swap-intent-sip009 (hash (buff 32)) (expiration-height uint) (amount uint) (recipient principal) (asset-contract <sip009-transfer-trait>))
	(begin
		(try! (register-swap-intent hash expiration-height amount recipient (contract-of asset-contract)))
		(contract-call? asset-contract transfer amount tx-sender (as-contract tx-sender))
	)
)

(define-public (register-swap-intent-sip010 (hash (buff 32)) (expiration-height uint) (token-id uint) (recipient principal) (asset-contract <sip010-transfer-trait>))
	(begin
		(try! (register-swap-intent hash expiration-height token-id recipient (contract-of asset-contract)))
		(contract-call? asset-contract transfer token-id tx-sender (as-contract tx-sender) none)
	)
)

(define-private (cancel-swap-intent (hash (buff 32)) (asset-contract principal))
	(let
		(
			(swap-intent (unwrap! (get-swap-intent hash tx-sender) err-unknown-swap-intent))
		)
		(asserts! (is-eq (get asset-contract swap-intent) asset-contract) err-invalid-asset-contract)
		(asserts! (>= block-height (get expiration-height swap-intent)) err-swap-intent-not-expired)
		(map-delete swap-intents {sender: tx-sender, hash: hash})
		(ok (get amount-or-token-id swap-intent))
	)
)

(define-public (cancel-swap-intent-sip009 (hash (buff 32)) (asset-contract <sip009-transfer-trait>))
	(let
		(
			(token-id (try! (cancel-swap-intent hash (contract-of asset-contract))))
			(sender tx-sender)
		)
		(as-contract (contract-call? asset-contract transfer token-id tx-sender sender))
	)
)

(define-public (cancel-swap-intent-sip010 (hash (buff 32)) (asset-contract <sip010-transfer-trait>))
	(let
		(
			(amount (try! (cancel-swap-intent hash (contract-of asset-contract))))
			(sender tx-sender)
		)
		(as-contract (contract-call? asset-contract transfer amount tx-sender sender none))
	)
)

(define-private (swap (sender principal) (preimage (buff 64)) (asset-contract principal))
	(let
		(
			(hash (sha256 preimage))
			(swap-intent (unwrap! (get-swap-intent hash sender) err-unknown-swap-intent))
		)
		(asserts! (is-eq (get asset-contract swap-intent) asset-contract) err-invalid-asset-contract)
		(asserts! (< block-height (get expiration-height swap-intent)) err-swap-intent-expired)
		(map-delete swap-intents {sender: sender, hash: hash})
		(ok swap-intent)
	)
)

(define-public (swap-sip009 (sender principal) (preimage (buff 64)) (asset-contract <sip009-transfer-trait>))
	(let
		(
			(swap-intent (try! (swap sender preimage (contract-of asset-contract))))
		)
		(as-contract (contract-call? asset-contract transfer (get amount-or-token-id swap-intent) tx-sender (get recipient swap-intent)))
	)
)

(define-public (swap-sip010 (sender principal) (preimage (buff 64)) (asset-contract <sip010-transfer-trait>))
	(let
		(
			(swap-intent (try! (swap sender preimage (contract-of asset-contract))))
		)
		(as-contract (contract-call? asset-contract transfer (get amount-or-token-id swap-intent) tx-sender (get recipient swap-intent) none))
	)
)