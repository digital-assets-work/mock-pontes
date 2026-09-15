# src/auth/csr-handler.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 90.00% (45/50) | `█████████░` |
| Branches | 76.19% (16/21) | `████████░░` |
| Functions | 100.00% (6/6) | `██████████` |
| Lines | 91.11% (41/45) | `█████████░` |

**Uncovered lines:** 61, 79, 137, 178

**Partial branches:** L74 (if), L77 (binary-expr), L94 (binary-expr), L95 (binary-expr), L136 (if)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   58 |     const values = entry[shortName];
   59 |     if (values && values.length) return values[0];
   60 |   }
-  61 |   return undefined;
   62 | }
   63 | 
   64 | /**
  ⋮
   71 |   if (!ext) return undefined;
   72 |   const raw = Buffer.from(ext.value).toString("utf8");
   73 |   const match = raw.match(/\{[\s\S]*\}/);
!  74 |   if (!match) return undefined;
   75 |   try {
   76 |     const json = JSON.parse(match[0]) as { attrs?: Record<string, string> } & Record<string, string>;
!  77 |     return (json.attrs ?? json).privilege;
   78 |   } catch {
-  79 |     return undefined;
   80 |   }
   81 | }
   82 | 
  ⋮
   91 |   subjectName: x509.Name,
   92 |   options: SignCsrOptions,
   93 | ): x509.Extension {
!  94 |   const enrollmentId = options.username || rdn(subjectName, "CN") || "";
!  95 |   const mspid = options.entityBIC || rdn(subjectName, "O") || "";
   96 |   const attrs: Record<string, string> = {
   97 |     "hf.Affiliation": "",
   98 |     "hf.EnrollmentID": enrollmentId,
  ⋮
  133 |   // shorter validity is requested (admin-token mode issues 1-hour certs, #35).
  134 |   const notBefore = new Date();
  135 |   const notAfter = new Date(notBefore);
! 136 |   if (options.validityMinutes != null) {
- 137 |     notAfter.setMinutes(notAfter.getMinutes() + options.validityMinutes);
  138 |   } else {
  139 |     notAfter.setMonth(notAfter.getMonth() + 24);
  140 |   }
  ⋮
  175 |     new x509.Pkcs10CertificateRequest(csrPem);
  176 |     return true;
  177 |   } catch (err) {
- 178 |     throw new Error(`Invalid CSR format: ${String(err).slice(0, 100)}`);
  179 |   }
  180 | }
  181 | 
```
