package main

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512
)

// ---- Inbound message types ----

type ClientMessage struct {
	Type  string `json:"type"`
	Left  bool   `json:"left"`
	Right bool   `json:"right"`
	Up    bool   `json:"up"`
	Down  bool   `json:"down"`
	Shoot bool   `json:"shoot"`
}

// ---- Welcome message ----

type WelcomeMsg struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
	Team string `json:"team"`
}

// ---- Hub ----

type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
}

func newHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 64),
	}
}

func (h *Hub) run() {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = true

		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}

		case msg := <-h.broadcast:
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// Slow client — evict
					close(c.send)
					delete(h.clients, c)
				}
			}
		}
	}
}

// ---- Client ----

type Client struct {
	id   string
	name string
	conn *websocket.Conn
	send chan []byte
	hub  *Hub
	game *Game
}

func (c *Client) readPump() {
	defer func() {
		ann, _ := json.Marshal(map[string]string{"type": "announce", "msg": c.name + " left", "kind": "leave"})
		select {
		case c.hub.broadcast <- ann:
		default:
		}
		c.hub.unregister <- c
		c.game.removePlayer(c.id)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("ws error [%s]: %v", c.name, err)
			}
			break
		}

		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			c.game.applyInput(c.id, PlayerInput{
				Left:  msg.Left,
				Right: msg.Right,
				Up:    msg.Up,
				Down:  msg.Down,
				Shoot: msg.Shoot,
			})
		case "restart":
			c.game.ResetGame()
		case "nextwave":
			c.game.NextWave()
		case "swap":
			c.game.swapTeam(c.id)
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
