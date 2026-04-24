package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/websocket"
	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

//go:embed static
var staticFS embed.FS

var upgrader = websocket.Upgrader{
	// All connections come from authenticated tailnet peers; skip origin check.
	CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
	srv := &tsnet.Server{
		Hostname: "invaders",
		AuthKey:  os.Getenv("TS_AUTHKEY"),
	}
	defer srv.Close()

	if err := srv.Start(); err != nil {
		log.Fatalf("tsnet start: %v", err)
	}

	lc, err := srv.LocalClient()
	if err != nil {
		log.Fatalf("local client: %v", err)
	}

	// Derive scores file path alongside tsnet state
	scoresFile := ""
	if dir, err := os.UserConfigDir(); err == nil {
		scoresFile = filepath.Join(dir, "tsnet-invaders", "highscores.json")
	}

	hub := newHub()
	game := newGame(hub, scoresFile)

	go hub.run()
	go game.run()

	ln, err := srv.Listen("tcp", ":80")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	log.Println("invaders listening on :80 via tailnet")

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("fs.Sub: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/ws", wsHandler(lc, hub, game))

	if err := http.Serve(ln, mux); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func wsHandler(lc *local.Client, hub *Hub, game *Game) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, err := lc.WhoIs(r.Context(), r.RemoteAddr)
		if err != nil {
			log.Printf("WhoIs failed for %s: %v", r.RemoteAddr, err)
			http.Error(w, "unauthorized", http.StatusForbidden)
			return
		}

		var loginName string
		if who.UserProfile != nil {
			loginName = who.UserProfile.LoginName
		}
		name := shortenName(loginName)
		id := newID()

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("upgrade: %v", err)
			return
		}

		client := &Client{
			id:   id,
			name: name,
			conn: conn,
			send: make(chan []byte, 256),
			hub:  hub,
			game: game,
		}

		hub.register <- client
		game.addPlayer(client)

		team := game.getPlayerTeam(id)
		welcome, _ := json.Marshal(WelcomeMsg{Type: "welcome", ID: id, Name: name, Team: team})
		client.send <- welcome

		ann, _ := json.Marshal(map[string]string{"type": "announce", "msg": name + " joined!", "kind": "join"})
		select {
		case hub.broadcast <- ann:
		default:
		}

		go client.writePump()
		client.readPump()
	}
}

func shortenName(loginName string) string {
	name := loginName
	if idx := strings.Index(name, "@"); idx >= 0 {
		name = name[:idx]
	}
	if len(name) > 12 {
		name = name[:12]
	}
	if name == "" {
		name = "player"
	}
	return name
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

