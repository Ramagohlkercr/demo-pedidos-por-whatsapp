#!/bin/zsh -l
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
clear
echo "=============================================="
echo " Demo Pedidos por WhatsApp"
echo " Catalogo: http://localhost:3001/"
echo " Panel:    http://localhost:3001/admin"
echo " Dejá esta ventana abierta. Para detener: Ctrl+C"
echo " La Mac no se duerme mientras esto este corriendo."
echo "=============================================="
caffeinate -i npm start
