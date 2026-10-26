# Hostile links

A `javascript:` link stays inert: [script](<javascript:alert(1)>), a
`data:text/html` link: [data](<data:text/html,<script>alert(1)</script>>), and a
`vbscript:` link: [vbscript](<vbscript:msgbox(1)>).

An off-root image does not load: ![escape](../secret.png).

A valid relative image still does: ![local](images/pixel.png).
