;; sip010-token
;; A SIP010-compliant fungible token with a mint function.

(impl-trait .sip010-trait.ft-trait)

(define-fungible-token test-sip010)

(define-constant err-not-token-owner (err u100))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
	(begin
		(asserts! (is-eq tx-sender sender) err-not-token-owner)
		(match memo to-print (print to-print) 0x)
		(ft-transfer? test-sip010 amount sender recipient)
	)
)

(define-read-only (get-name)
	(ok "test-sip010")
)

(define-read-only (get-symbol)
	(ok "test")
)

(define-read-only (get-decimals)
	(ok u6)
)

(define-read-only (get-balance (who principal))
	(ok (ft-get-balance test-sip010 who))
)

(define-read-only (get-total-supply)
	(ok (ft-get-supply test-sip010))
)

(define-read-only (get-token-uri)
	(ok none)
)

(define-public (mint (amount uint) (recipient principal))
	(ft-mint? test-sip010 amount recipient)
)