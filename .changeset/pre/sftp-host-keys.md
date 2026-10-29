---
'vespercms': patch
---

The SFTP workflow `vesper deploy init` writes checks a server by its plain host keys, so a server that offers a host certificate first no longer fails host key verification, and it strips stray carriage returns from its secrets.
