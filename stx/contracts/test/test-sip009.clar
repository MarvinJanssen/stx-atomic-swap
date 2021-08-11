;; Test SIP009 NFT

(impl-trait .sip009-trait.nft-trait)

(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))

(define-non-fungible-token test-sip009 uint)
(define-data-var token-id-nonce uint u0)

(define-read-only (get-last-token-id)
	(ok (var-get token-id-nonce))
)

(define-read-only (get-token-uri (token-id uint))
	(ok none)
)

(define-read-only (get-owner (token-id uint))
	(ok (nft-get-owner? test-sip009 token-id))
)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
	(begin
		(asserts! (is-eq tx-sender sender) err-not-token-owner)
		(nft-transfer? test-sip009 token-id sender recipient)
	)
)

(define-public (mint (recipient principal))
	(let ((token-id (+ (var-get token-id-nonce) u1)))
		(try! (nft-mint? test-sip009 token-id recipient))
		(var-set token-id-nonce token-id)
		(ok token-id)
	)
)
