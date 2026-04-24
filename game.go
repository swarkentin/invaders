package main

import (
	"encoding/json"
	"log"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// ---- Constants ----

const (
	CanvasW = 900.0
	CanvasH = 650.0

	// Regular player ship (bottom row)
	PlayerY     = 600.0
	PlayerW     = 48.0
	PlayerH     = 36.0
	PlayerSpeed = 5.0

	// Invader player ship (upper zone)
	InvaderYMin    = 80.0
	InvaderYMax    = 470.0
	InvaderSpeed   = 6.0
	InvaderBulletSpeed = 8.0 // downward

	// Player health (3 hits to kill)
	PlayerMaxHealth = 3
	PlayerHitDamage = 1
	ExplosionTicks  = 45

	// Chance to respawn as invader after death
	InvaderRespawnChance = 0.40

	// AI enemies
	EnemyCols     = 11
	EnemyRows     = 5
	EnemyW        = 36.0
	EnemyH        = 24.0
	EnemyPadX     = 16.0
	EnemyPadY     = 16.0
	EnemyStartX   = 40.0
	EnemyStartY   = 60.0
	EnemyStepDown = 20.0
	EnemySpeedCap = 8.0

	// Bullets
	BulletW           = 4.0
	BulletH           = 12.0
	PlayerBulletSpeed = -16.0 // upward
	EnemyBulletSpeed  = 6.0   // downward

	EnemyFireInterval = 60 // ticks between AI shots
	FireCooldownTicks = 12 // ~400ms at 30fps

	// Game over
	EnemyBottomLimit = 564.0 // enemies reaching this Y → game over
	GameOverDelay    = 90    // ticks before auto-reset

	// Shields / bunkers
	ShieldCellSize = 9.0
	BunkerCols     = 8
	BunkerRows     = 5
	BunkerCount    = 4
	ShieldY        = 490.0

	// UFO
	UFOWidth       = 52.0
	UFOHeight      = 22.0
	UFOSpeed       = 9.0
	UFOY           = 28.0
	UFOMinInterval = 600  // ticks
	UFOMaxInterval = 1500 // ticks

	// Scoring
	PointsTop    = 30
	PointsMiddle = 20
	PointsBottom = 10

	LeaderboardSize = 10

	// Power-ups
	PowerupW           = 18.0
	PowerupH           = 18.0
	PowerupFallSpeed   = 2.2
	PowerupSpawnChance       = 0.06    // 6% per enemy kill
	PowerupRandomSpawnChance = 0.0015 // ~4.5% per second at 30fps
	PowerupDuration          = 450    // ticks (~15 s at 30fps)
	PowerupMaxRandom         = 3      // cap on simultaneously live random-spawned powerups
	HealthRestoreAmt   = 40
	SpeedBoostMulti    = 2.0  // speed multiplier for PowerSpeed

	// Bomb enemies
	BombChance   = 0.0003 // per alive enemy per tick (~1 bomb every ~2 s with 50 enemies)
	BombDuration = 120    // ticks (~4 s) before reverting
	BombRadius   = 90.0   // blast radius in pixels

	TicksPerSecond = 30
	TickInterval   = time.Second / TicksPerSecond
)

// Castle battlement bunker shape (5 rows × 8 cols)
var bunkerTemplate = [BunkerRows][BunkerCols]bool{
	{true, false, true, false, false, true, false, true},
	{true, true, true, true, true, true, true, true},
	{true, true, true, true, true, true, true, true},
	{true, true, false, false, false, false, true, true},
	{true, true, false, false, false, false, true, true},
}

// ---- Geometry ----

type Rect struct{ X, Y, W, H float64 }

func aabb(a, b Rect) bool {
	return a.X < b.X+b.W && a.X+a.W > b.X &&
		a.Y < b.Y+b.H && a.Y+a.H > b.Y
}

// ---- Player ----

type PlayerInput struct {
	Left  bool
	Right bool
	Up    bool
	Down  bool
	Shoot bool
}

type Player struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	W           float64 `json:"w"`
	H           float64 `json:"h"`
	Score       int     `json:"score"`
	Health      int     `json:"health"`
	MaxHealth   int     `json:"maxHealth"`
	ExplodeTick int     `json:"explodeTick"` // counts down; >0 means exploding
	Team        string  `json:"team"`         // "regular" or "invader"
	PowerRapid  int     `json:"powerRapid"`
	PowerWide   int     `json:"powerWide"`
	PowerMulti  int     `json:"powerMulti"`
	PowerSpeed  int     `json:"powerSpeed"`

	input PlayerInput
}

// ---- Enemy ----

type Enemy struct {
	ID       int     `json:"id"`
	Col      int     `json:"col"`
	Row      int     `json:"row"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	Alive    bool    `json:"alive"`
	Points   int     `json:"points"`
	Bomb     bool    `json:"bomb"`
	BombTick int     `json:"bombTick"`
}

// ---- Bullet ----
// Owner: "regular" = regular player going up,
//        "invader" = invader player going down,
//        "enemy"   = AI enemy going down.

type Bullet struct {
	ID       int     `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	VY       float64 `json:"vy"`
	Owner    string  `json:"owner"`
	PlayerID string  `json:"playerId"`

	dead bool
}

// ---- PowerUp ----

type PowerUp struct {
	ID   int     `json:"id"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	W    float64 `json:"w"`
	H    float64 `json:"h"`
	Type string  `json:"type"`
}

// ---- Shield cell ----

type ShieldCell struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	HP    int     `json:"hp"` // 2=intact, 1=cracked
	Group int     `json:"group"`
}

// ---- UFO (critter) ----

// Pattern: 0=sine wave, 1=diagonal bounce, 2=zigzag, 3=swoop
type UFO struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	W       float64 `json:"w"`
	H       float64 `json:"h"`
	VX      float64 `json:"vx"`
	VY      float64 `json:"vy"`
	Phase   float64 `json:"phase"`
	Pattern int     `json:"pattern"`
	Animal  int     `json:"animal"` // 0..5 sprite index
	Points  int     `json:"points"`
}

// ---- UFO kill event (broadcast for one tick) ----

type UFOKillEvent struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Points int     `json:"points"`
	Animal int     `json:"animal"`
}

// ---- Bomb kill event (broadcast for one tick) ----

type BombKillEvent struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Count  int     `json:"count"`  // number of enemies caught in blast
	Points int     `json:"points"` // total points awarded
}

// ---- Leaderboard ----

type LeaderboardEntry struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
}

// ---- Game State (broadcast to clients) ----

type GameState struct {
	Tick        int64              `json:"tick"`
	Wave        int                `json:"wave"`
	Players     []*Player          `json:"players"`
	Enemies     []*Enemy           `json:"enemies"`
	Bullets     []*Bullet          `json:"bullets"`
	Shields     []*ShieldCell      `json:"shields"`
	PowerUps    []*PowerUp         `json:"powerups"`
	UFO         *UFO               `json:"ufo"`
	UFOKill     *UFOKillEvent      `json:"ufoKill,omitempty"`
	BombKill    *BombKillEvent     `json:"bombKill,omitempty"`
	Leaderboard []LeaderboardEntry `json:"leaderboard"`
	GameOver    bool               `json:"gameOver"`
	EnemySpeed  float64            `json:"enemySpeed"`
}

type StateMsg struct {
	Type  string    `json:"type"`
	State GameState `json:"state"`
}

// ---- Game ----

type Game struct {
	mu  sync.Mutex
	hub *Hub

	players  map[string]*Player
	enemies  []*Enemy
	bullets  []*Bullet
	shields  []*ShieldCell
	powerups []*PowerUp
	ufo      *UFO
	ufoKill  *UFOKillEvent  // set for one tick when UFO is shot
	bombKill *BombKillEvent // set for one tick when bomb enemy explodes

	powerupSeq int

	wave        int
	enemyDirX   float64
	enemySpeed  float64
	tick        int64
	bulletSeq   int
	ufoNextTick int64

	lastFireTick  map[string]int64
	allTimeScores map[string]int
	scoresFile    string

	gameOver     bool
	gameOverTick int64

	cachedLeaderboard []LeaderboardEntry
	leaderboardDirty  bool
	scoresDirty       bool
}

func newGame(hub *Hub, scoresFile string) *Game {
	g := &Game{
		hub:           hub,
		players:       make(map[string]*Player),
		lastFireTick:  make(map[string]int64),
		allTimeScores: make(map[string]int),
		scoresFile:    scoresFile,
		wave:          1,
		enemyDirX:     1.0,
	}
	g.loadScores()
	g.spawnWave()
	g.spawnShields()
	g.ufoNextTick = int64(UFOMinInterval + rand.Intn(UFOMaxInterval-UFOMinInterval))
	return g
}

func (g *Game) loadScores() {
	if g.scoresFile == "" {
		return
	}
	data, err := os.ReadFile(g.scoresFile)
	if err != nil {
		return // file doesn't exist yet — fine
	}
	if err := json.Unmarshal(data, &g.allTimeScores); err != nil {
		log.Printf("loadScores: %v", err)
	}
}

func (g *Game) saveScores() {
	if g.scoresFile == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(g.scoresFile), 0755); err != nil {
		log.Printf("saveScores mkdir: %v", err)
		return
	}
	data, err := json.Marshal(g.allTimeScores)
	if err != nil {
		return
	}
	if err := os.WriteFile(g.scoresFile, data, 0644); err != nil {
		log.Printf("saveScores: %v", err)
	}
}

// ---- Wave / Shield spawning ----

type waveConfig struct {
	cols, rows     int
	startX, startY float64
}

var waveConfigs = []waveConfig{
	{7, 3, 80.0, 60.0},   // wave 1: small intro grid
	{10, 4, 40.0, 60.0},  // wider, 4 rows
	{9, 5, 65.0, 55.0},   // taller
	{11, 5, 40.0, 45.0},  // standard
	{13, 4, 15.0, 55.0},  // wide and shallow
	{10, 6, 50.0, 42.0},  // 6 rows, slightly narrow
	{15, 3, 8.0, 60.0},   // very wide, sparse rows
	{11, 6, 40.0, 42.0},  // full grid
}

func (g *Game) spawnWave() {
	cfg := waveConfigs[(g.wave-1)%len(waveConfigs)]
	g.bullets = g.bullets[:0]
	g.powerups = g.powerups[:0]
	g.enemies = make([]*Enemy, 0, cfg.cols*cfg.rows)
	if rand.Intn(2) == 0 {
		g.enemyDirX = -1.0
	} else {
		g.enemyDirX = 1.0
	}

	id := 0
	for row := 0; row < cfg.rows; row++ {
		var pts int
		switch {
		case row <= 1:
			pts = PointsTop
		case row == 2:
			pts = PointsMiddle
		default:
			pts = PointsBottom
		}
		for col := 0; col < cfg.cols; col++ {
			g.enemies = append(g.enemies, &Enemy{
				ID:     id,
				Col:    col,
				Row:    row,
				X:      cfg.startX + float64(col)*(EnemyW+EnemyPadX),
				Y:      cfg.startY + float64(row)*(EnemyH+EnemyPadY),
				W:      EnemyW,
				H:      EnemyH,
				Alive:  true,
				Points: pts,
			})
			id++
		}
	}
}

func (g *Game) spawnShields() {
	const playW = CanvasW // full canvas width (leaderboard is now external)
	const bunkerW = BunkerCols * ShieldCellSize
	const totalGap = playW - BunkerCount*bunkerW
	const gap = totalGap / (BunkerCount + 1)

	g.shields = g.shields[:0]
	for b := 0; b < BunkerCount; b++ {
		bx := gap + float64(b)*(bunkerW+gap)
		for row := 0; row < BunkerRows; row++ {
			for col := 0; col < BunkerCols; col++ {
				if !bunkerTemplate[row][col] {
					continue
				}
				g.shields = append(g.shields, &ShieldCell{
					X:     bx + float64(col)*ShieldCellSize,
					Y:     ShieldY + float64(row)*ShieldCellSize,
					W:     ShieldCellSize,
					H:     ShieldCellSize,
					HP:    2,
					Group: b,
				})
			}
		}
	}
}

// ---- Game loop ----

func (g *Game) run() {
	ticker := time.NewTicker(TickInterval)
	defer ticker.Stop()
	for range ticker.C {
		g.tickOnce()
	}
}

func (g *Game) tickOnce() {
	g.mu.Lock()

	g.ufoKill = nil  // clear one-tick events from previous tick
	g.bombKill = nil
	g.tick++

	// Flush scores to disk at most once every 10 s (300 ticks)
	if g.scoresDirty && g.tick%300 == 0 {
		g.saveScores()
		g.scoresDirty = false
	}

	if g.gameOver {
		if g.tick-g.gameOverTick >= GameOverDelay {
			g.resetGame()
		}
	} else {
		g.processInputs()
		g.moveEnemies()
		g.updateBombs()
		g.moveUFO()
		g.moveBullets()
		g.movePowerups()
		g.randomSpawnPowerup()
		g.enemyFire()
		g.collide()
		g.collectPowerups()
		g.decrementTimers()
		g.checkWaveClear()
		g.checkGameOver()
	}

	msg := g.buildStateMsg()
	g.mu.Unlock()

	data, err := json.Marshal(msg)
	if err == nil {
		select {
		case g.hub.broadcast <- data:
		default:
		}
	}
}

// ---- Input processing ----

func (g *Game) processInputs() {
	for id, p := range g.players {
		if p.ExplodeTick > 0 {
			continue // can't act while exploding
		}

		baseSpd := PlayerSpeed
		if p.Team == "invader" {
			baseSpd = InvaderSpeed
		}
		spd := baseSpd
		if p.PowerSpeed > 0 {
			spd *= SpeedBoostMulti
		}

		if p.input.Left {
			p.X -= spd
			if p.X < 0 {
				p.X = 0
			}
		}
		if p.input.Right {
			p.X += spd
			if p.X > CanvasW-PlayerW {
				p.X = CanvasW - PlayerW
			}
		}
		if p.Team == "invader" {
			if p.input.Up {
				p.Y -= spd
				if p.Y < InvaderYMin {
					p.Y = InvaderYMin
				}
			}
			if p.input.Down {
				p.Y += spd
				if p.Y > InvaderYMax {
					p.Y = InvaderYMax
				}
			}
		}

		cooldown := int64(FireCooldownTicks)
		if p.PowerRapid > 0 {
			cooldown = FireCooldownTicks / 3
		}
		if p.input.Shoot && g.tick-g.lastFireTick[id] >= cooldown {
			bw, bh := BulletW, BulletH
			if p.PowerWide > 0 {
				bw = BulletW * 4
				bh = BulletH * 1.5
			}
			if p.Team == "regular" {
				cx := p.X + PlayerW/2
				by := p.Y - bh
				if p.PowerMulti > 0 {
					// 3-shot spread
					for _, off := range []float64{-14, 0, 14} {
						g.bulletSeq++
						g.bullets = append(g.bullets, &Bullet{
							ID: g.bulletSeq, X: cx + off - bw/2, Y: by,
							W: bw, H: bh, VY: PlayerBulletSpeed,
							Owner: "regular", PlayerID: id,
						})
					}
				} else {
					g.bulletSeq++
					g.bullets = append(g.bullets, &Bullet{
						ID: g.bulletSeq, X: cx - bw/2, Y: by,
						W: bw, H: bh, VY: PlayerBulletSpeed,
						Owner: "regular", PlayerID: id,
					})
				}
			} else {
				cx := p.X + PlayerW/2
				by := p.Y + PlayerH
				if p.PowerMulti > 0 {
					for _, off := range []float64{-14, 0, 14} {
						g.bulletSeq++
						g.bullets = append(g.bullets, &Bullet{
							ID: g.bulletSeq, X: cx + off - bw/2, Y: by,
							W: bw, H: bh, VY: InvaderBulletSpeed,
							Owner: "invader", PlayerID: id,
						})
					}
				} else {
					g.bulletSeq++
					g.bullets = append(g.bullets, &Bullet{
						ID: g.bulletSeq, X: cx - bw/2, Y: by,
						W: bw, H: bh, VY: InvaderBulletSpeed,
						Owner: "invader", PlayerID: id,
					})
				}
			}
			g.lastFireTick[id] = g.tick
		}
	}
}

// ---- Enemy movement ----

func (g *Game) moveEnemies() {
	// Pre-movement pass: find bounds and lowest Y position
	leftEdge, rightEdge, lowestY := CanvasW, 0.0, EnemyStartY
	anyAlive := false
	aliveCount := 0
	totalCount := len(g.enemies)
	for _, e := range g.enemies {
		if !e.Alive {
			continue
		}
		anyAlive = true
		aliveCount++
		if e.X < leftEdge {
			leftEdge = e.X
		}
		if e.X+e.W > rightEdge {
			rightEdge = e.X + e.W
		}
		if e.Y > lowestY {
			lowestY = e.Y
		}
	}
	if !anyAlive {
		return
	}

	baseSpeed := 0.85 + float64(g.wave-1)*0.25
	descent := (lowestY - EnemyStartY) / (EnemyBottomLimit - EnemyStartY)
	if descent < 0 {
		descent = 0
	}
	if descent > 1 {
		descent = 1
	}
	// Survivor multiplier: speed increases as enemies are eliminated (1.0× full → ~3.5× last few)
	survivorMult := 1.0
	if totalCount > 0 {
		survivorMult = 1.0 + (1.0-float64(aliveCount)/float64(totalCount))*0.3
	}
	speed := baseSpeed * (1.0 + descent*1.5) * survivorMult
	if speed > EnemySpeedCap {
		speed = EnemySpeedCap
	}
	g.enemySpeed = speed

	for _, e := range g.enemies {
		if e.Alive {
			e.X += speed * g.enemyDirX
		}
	}

	const wall = 8.0
	// Random step-down between 60%–140% of base for variety
	stepDown := EnemyStepDown * (0.6 + rand.Float64()*0.8)
	if g.enemyDirX > 0 && rightEdge >= CanvasW-wall {
		g.enemyDirX = -1
		for _, e := range g.enemies {
			if e.Alive {
				e.Y += stepDown
			}
		}
	} else if g.enemyDirX < 0 && leftEdge <= wall {
		g.enemyDirX = 1
		for _, e := range g.enemies {
			if e.Alive {
				e.Y += stepDown
			}
		}
	}
}

// ---- UFO movement ----

func (g *Game) moveUFO() {
	if g.ufo == nil {
		if g.tick >= g.ufoNextTick {
			g.spawnUFO()
		}
		return
	}
	u := g.ufo
	u.Phase += 0.05
	switch u.Pattern {
	case 0: // sine wave — horizontal with Y oscillating
		u.X += u.VX
		u.Y = UFOY + 40 + math.Sin(u.Phase)*35
	case 1: // diagonal bounce
		u.X += u.VX
		u.Y += u.VY
		if u.Y < UFOY || u.Y > UFOY+80 {
			u.VY = -u.VY
		}
	case 2: // zigzag — reverses VX periodically
		u.X += u.VX
		u.Y = UFOY + 30 + math.Sin(u.Phase*2)*25
	case 3: // swoop — dips deep then back up
		u.X += u.VX
		u.Y = UFOY + 15 + math.Abs(math.Sin(u.Phase*0.5))*120
	}
	if u.X > CanvasW+UFOWidth*2 || u.X < -UFOWidth*3 {
		g.ufo = nil
		g.ufoNextTick = g.tick + int64(UFOMinInterval+rand.Intn(UFOMaxInterval-UFOMinInterval))
	}
}

func (g *Game) spawnUFO() {
	pts := []int{50, 100, 150, 200}[rand.Intn(4)]
	pattern := rand.Intn(4)
	animal := rand.Intn(6)
	var x, vx float64
	if rand.Intn(2) == 0 {
		x = -UFOWidth
		vx = UFOSpeed
	} else {
		x = CanvasW + UFOWidth
		vx = -UFOSpeed
	}
	vy := (rand.Float64()*2 - 1) * 1.5
	g.ufo = &UFO{
		X: x, Y: UFOY, W: UFOWidth, H: UFOHeight,
		VX: vx, VY: vy, Pattern: pattern, Animal: animal, Points: pts,
	}
}

// ---- Bullet movement ----

func (g *Game) moveBullets() {
	kept := g.bullets[:0]
	for _, b := range g.bullets {
		b.Y += b.VY
		if b.Y < -BulletH || b.Y > CanvasH {
			continue
		}
		kept = append(kept, b)
	}
	g.bullets = kept
}

// ---- AI enemy fire ----

func (g *Game) enemyFire() {
	if g.tick%EnemyFireInterval != 0 {
		return
	}
	reps := make(map[int]*Enemy)
	for _, e := range g.enemies {
		if !e.Alive {
			continue
		}
		if existing, ok := reps[e.Col]; !ok || e.Y > existing.Y {
			reps[e.Col] = e
		}
	}
	if len(reps) == 0 {
		return
	}
	cols := make([]*Enemy, 0, len(reps))
	for _, e := range reps {
		cols = append(cols, e)
	}
	chosen := cols[rand.Intn(len(cols))]
	g.bulletSeq++
	g.bullets = append(g.bullets, &Bullet{
		ID:    g.bulletSeq,
		X:     chosen.X + chosen.W/2 - BulletW/2,
		Y:     chosen.Y + chosen.H,
		W:     BulletW,
		H:     BulletH,
		VY:    EnemyBulletSpeed,
		Owner: "enemy",
	})
}

// ---- Power-up movement / collection ----

func (g *Game) movePowerups() {
	kept := g.powerups[:0]
	for _, pu := range g.powerups {
		pu.Y += PowerupFallSpeed
		if pu.Y <= CanvasH {
			kept = append(kept, pu)
		}
	}
	g.powerups = kept
}

func (g *Game) collectPowerups() {
	kept := g.powerups[:0]
	for _, pu := range g.powerups {
		pr := Rect{pu.X, pu.Y, pu.W, pu.H}
		collected := false
		for _, p := range g.players {
			if p.ExplodeTick > 0 {
				continue
			}
			if aabb(pr, Rect{p.X, p.Y, p.W, p.H}) {
				g.applyPowerup(p, pu.Type)
				collected = true
				break
			}
		}
		if !collected {
			kept = append(kept, pu)
		}
	}
	g.powerups = kept
}

func (g *Game) applyPowerup(p *Player, puType string) {
	switch puType {
	case "rapid":
		p.PowerRapid = PowerupDuration
	case "wide":
		p.PowerWide = PowerupDuration
	case "multi":
		p.PowerMulti = PowerupDuration
	case "speed":
		p.PowerSpeed = PowerupDuration
	case "health":
		p.Health += HealthRestoreAmt
		if p.Health > p.MaxHealth {
			p.Health = p.MaxHealth
		}
	}
}

func (g *Game) randomSpawnPowerup() {
	if len(g.powerups) >= PowerupMaxRandom {
		return
	}
	if rand.Float64() >= PowerupRandomSpawnChance {
		return
	}
	// Spawn at a random X in the play field, just above the visible area so it drifts in
	x := PowerupW + rand.Float64()*(CanvasW-PowerupW*2)
	g.spawnPowerup(x, -PowerupH)
}

func (g *Game) anyPlayerNeedsHealth() bool {
	for _, p := range g.players {
		if p.Health < p.MaxHealth {
			return true
		}
	}
	return false
}

func (g *Game) spawnPowerup(x, y float64) {
	types := []string{"rapid", "wide", "multi", "speed", "health"}
	// Don't drop a health power-up if all players are at full health
	if !g.anyPlayerNeedsHealth() {
		types = []string{"rapid", "wide", "multi", "speed"}
	}
	t := types[rand.Intn(len(types))]
	g.powerupSeq++
	g.powerups = append(g.powerups, &PowerUp{
		ID: g.powerupSeq, X: x, Y: y, W: PowerupW, H: PowerupH, Type: t,
	})
}

// ---- Bomb enemy logic ----

func (g *Game) updateBombs() {
	hasBomb := false
	for _, e := range g.enemies {
		if !e.Alive || !e.Bomb {
			continue
		}
		e.BombTick--
		if e.BombTick <= 0 {
			e.Bomb = false
			e.BombTick = 0
		} else {
			hasBomb = true
		}
	}
	if hasBomb {
		return // only one bomb at a time
	}
	// Randomly select an alive enemy to become a bomb
	for _, e := range g.enemies {
		if e.Alive && rand.Float64() < BombChance {
			e.Bomb = true
			e.BombTick = BombDuration
			break
		}
	}
}

func (g *Game) bulletHitsShield(b *Bullet) bool {
	br := Rect{b.X, b.Y, b.W, b.H}
	for _, s := range g.shields {
		if s.HP <= 0 {
			continue
		}
		if aabb(br, Rect{s.X, s.Y, s.W, s.H}) {
			b.dead = true
			s.HP--
			return true
		}
	}
	return false
}

// ---- Collision detection ----

func (g *Game) collide() {
	// --- Regular player bullets (going up) ---
	// Can hit: AI enemies, invader players, shields, UFO
	for _, b := range g.bullets {
		if b.Owner != "regular" || b.dead {
			continue
		}
		br := Rect{b.X, b.Y, b.W, b.H}

		// vs UFO
		if g.ufo != nil && aabb(br, Rect{g.ufo.X, g.ufo.Y, g.ufo.W, g.ufo.H}) {
			if p, ok := g.players[b.PlayerID]; ok {
				p.Score += g.ufo.Points
				g.updateLeaderboard(p)
			}
			b.dead = true
			g.ufoKill = &UFOKillEvent{
				X:      g.ufo.X + g.ufo.W/2,
				Y:      g.ufo.Y + g.ufo.H/2,
				Points: g.ufo.Points,
				Animal: g.ufo.Animal,
			}
			g.ufo = nil
			g.ufoNextTick = g.tick + int64(UFOMinInterval+rand.Intn(UFOMaxInterval-UFOMinInterval))
			continue
		}

		// vs AI enemies
		hit := false
		for _, e := range g.enemies {
			if !e.Alive {
				continue
			}
			if aabb(br, Rect{e.X, e.Y, e.W, e.H}) {
				b.dead = true
				hit = true
				if e.Bomb {
					// Chain explosion: kill all enemies in blast radius
					cx, cy := e.X+e.W/2, e.Y+e.H/2
					totalPts, count := 0, 0
					for _, other := range g.enemies {
						if !other.Alive {
							continue
						}
						dx := other.X + other.W/2 - cx
						dy := other.Y + other.H/2 - cy
						if dx*dx+dy*dy <= BombRadius*BombRadius {
							other.Alive = false
							totalPts += other.Points
							count++
						}
					}
					if p, ok := g.players[b.PlayerID]; ok {
						p.Score += totalPts
						g.updateLeaderboard(p)
					}
					g.bombKill = &BombKillEvent{X: cx, Y: cy, Count: count, Points: totalPts}
				} else {
					e.Alive = false
					if p, ok := g.players[b.PlayerID]; ok {
						p.Score += e.Points
						g.updateLeaderboard(p)
					}
					if rand.Float64() < PowerupSpawnChance {
						g.spawnPowerup(e.X+e.W/2-PowerupW/2, e.Y)
					}
				}
				break
			}
		}
		if hit {
			continue
		}

		// vs invader players
		for _, p := range g.players {
			if p.Team != "invader" || p.ExplodeTick > 0 {
				continue
			}
			if aabb(br, Rect{p.X, p.Y, p.W, p.H}) {
				b.dead = true
				g.damagePlayer(p, b.PlayerID)
				break
			}
		}
		if b.dead {
			continue
		}

		g.bulletHitsShield(b)
	}

	// --- Invader player bullets (going down) ---
	// Can hit: regular players, shields
	for _, b := range g.bullets {
		if b.Owner != "invader" || b.dead {
			continue
		}
		br := Rect{b.X, b.Y, b.W, b.H}

		// vs regular players
		for _, p := range g.players {
			if p.Team != "regular" || p.ExplodeTick > 0 {
				continue
			}
			if aabb(br, Rect{p.X, p.Y, p.W, p.H}) {
				b.dead = true
				g.damagePlayer(p, b.PlayerID)
				// Invader shooter gets points for hit
				if shooter, ok := g.players[b.PlayerID]; ok {
					shooter.Score += 15
					g.updateLeaderboard(shooter)
				}
				break
			}
		}
		if b.dead {
			continue
		}

		g.bulletHitsShield(b)
	}

	// --- AI enemy bullets (going down) ---
	// Can hit: regular players, shields
	for _, b := range g.bullets {
		if b.Owner != "enemy" || b.dead {
			continue
		}
		br := Rect{b.X, b.Y, b.W, b.H}

		// vs regular players
		for _, p := range g.players {
			if p.Team != "regular" || p.ExplodeTick > 0 {
				continue
			}
			if aabb(br, Rect{p.X, p.Y, p.W, p.H}) {
				b.dead = true
				g.damagePlayer(p, "")
				break
			}
		}
		if b.dead {
			continue
		}

		g.bulletHitsShield(b)
	}

	// Enemy-shield collision: advancing enemies crush shields
	for _, e := range g.enemies {
		if !e.Alive {
			continue
		}
		er := Rect{e.X, e.Y, e.W, e.H}
		for _, s := range g.shields {
			if s.HP > 0 && aabb(er, Rect{s.X, s.Y, s.W, s.H}) {
				s.HP = 0
			}
		}
	}

	// Purge dead bullets
	kept := g.bullets[:0]
	for _, b := range g.bullets {
		if !b.dead {
			kept = append(kept, b)
		}
	}
	g.bullets = kept

	// Purge destroyed shield cells
	ks := g.shields[:0]
	for _, s := range g.shields {
		if s.HP > 0 {
			ks = append(ks, s)
		}
	}
	g.shields = ks
}

func (p *Player) clearPowers() {
	p.PowerRapid = 0
	p.PowerWide = 0
	p.PowerMulti = 0
	p.PowerSpeed = 0
}

// damagePlayer applies a hit: reduces health, triggers explosion at 0.
// shooterID is the player who scored the kill (empty for AI).
func (g *Game) damagePlayer(p *Player, shooterID string) {
	p.Health -= PlayerHitDamage
	if p.Health <= 0 {
		p.Health = 0
		p.Score = 0
		g.allTimeScores[p.Name] = 0 // wipe leaderboard entry on death
		p.clearPowers()
		p.ExplodeTick = ExplosionTicks
	}
}

// ---- Timer countdowns ----

func (g *Game) decrementTimers() {
	for _, p := range g.players {
		if p.ExplodeTick > 0 {
			p.ExplodeTick--
			if p.ExplodeTick == 0 {
				p.Health = p.MaxHealth
				if len(g.players) > 1 && rand.Float64() < InvaderRespawnChance {
					p.Team = "invader"
				} else {
					p.Team = "regular"
				}
				g.respawnPosition(p)
			}
		}
		if p.PowerRapid > 0 {
			p.PowerRapid--
		}
		if p.PowerWide > 0 {
			p.PowerWide--
		}
		if p.PowerMulti > 0 {
			p.PowerMulti--
		}
		if p.PowerSpeed > 0 {
			p.PowerSpeed--
		}
	}
}

// ---- Wave / game over checks ----

func (g *Game) checkWaveClear() {
	for _, e := range g.enemies {
		if e.Alive {
			return
		}
	}
	g.wave++
	g.spawnWave()
	if g.wave%20 == 0 {
		g.spawnShields()
	}
}

func (g *Game) checkGameOver() {
	for _, e := range g.enemies {
		if e.Alive && e.Y+e.H > EnemyBottomLimit {
			g.gameOver = true
			g.gameOverTick = g.tick
			return
		}
	}
}

// ---- Skip to next wave (debug shortcut) ----

func (g *Game) NextWave() {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, e := range g.enemies {
		e.Alive = false
	}
	// Clear enemy bullets so they don't animate or deal damage during wave transition
	kept := g.bullets[:0]
	for _, b := range g.bullets {
		if b.Owner != "enemy" {
			kept = append(kept, b)
		}
	}
	g.bullets = kept
}

// ---- Reset game (lock must already be held OR use ResetGame for external callers) ----

func (g *Game) ResetGame() {
	g.mu.Lock()
	g.resetGame()
	g.mu.Unlock()
}

func (g *Game) resetGame() {
	g.wave = 1
	g.gameOver = false
	g.gameOverTick = 0
	g.ufo = nil
	g.ufoNextTick = g.tick + int64(UFOMinInterval+rand.Intn(UFOMaxInterval-UFOMinInterval))
	g.allTimeScores = make(map[string]int) // wipe leaderboard on new game
	g.leaderboardDirty = true
	g.spawnWave()
	g.spawnShields()
	for _, p := range g.players {
		p.Health = p.MaxHealth
		p.Score = 0
		p.ExplodeTick = 0
		p.clearPowers()
		// Random team assignment on game over (never invader if playing solo)
		if len(g.players) > 1 && rand.Float64() < InvaderRespawnChance {
			p.Team = "invader"
		} else {
			p.Team = "regular"
		}
		g.respawnPosition(p)
	}
	// Clear per-player fire cooldowns
	for id := range g.lastFireTick {
		g.lastFireTick[id] = -FireCooldownTicks
	}
}

// ---- Player management ----

func (g *Game) addPlayer(c *Client) {
	g.mu.Lock()
	defer g.mu.Unlock()

	team := g.assignTeam()
	p := &Player{
		ID:        c.id,
		Name:      c.name,
		W:         PlayerW,
		H:         PlayerH,
		Health:    PlayerMaxHealth,
		MaxHealth: PlayerMaxHealth,
		Team:      team,
	}
	g.respawnPosition(p)
	g.players[c.id] = p
	g.lastFireTick[c.id] = -FireCooldownTicks
}

func (g *Game) getPlayerTeam(id string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	if p, ok := g.players[id]; ok {
		return p.Team
	}
	return "regular"
}

func (g *Game) removePlayer(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.players, id)
	delete(g.lastFireTick, id)
	if g.scoresDirty {
		g.saveScores()
		g.scoresDirty = false
	}
}

func (g *Game) swapTeam(playerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p, ok := g.players[playerID]
	if !ok {
		return
	}
	// Solo player can never be forced to invader
	if len(g.players) <= 1 {
		return
	}
	if p.Team == "invader" {
		p.Team = "regular"
	} else {
		p.Team = "invader"
	}
}

func (g *Game) applyInput(playerID string, input PlayerInput) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if p, ok := g.players[playerID]; ok {
		p.input = input
	}
}

func (g *Game) assignTeam() string {
	regulars, invaders := 0, 0
	for _, p := range g.players {
		if p.Team == "invader" {
			invaders++
		} else {
			regulars++
		}
	}
	// First player always regular; beyond that, up to ~1 invader per 3 regulars
	if regulars == 0 {
		return "regular"
	}
	if invaders < regulars/3+1 && rand.Float64() < 0.35 {
		return "invader"
	}
	return "regular"
}

func (g *Game) respawnPosition(p *Player) {
	if p.Team == "invader" {
		p.X = 40 + rand.Float64()*(CanvasW-80-PlayerW)
		p.Y = InvaderYMin + rand.Float64()*(InvaderYMax-InvaderYMin-100)
	} else {
		p.X = 40 + rand.Float64()*(700-PlayerW)
		p.Y = PlayerY
	}
}

// ---- Leaderboard ----

func (g *Game) updateLeaderboard(p *Player) {
	if p.Score > g.allTimeScores[p.Name] {
		g.allTimeScores[p.Name] = p.Score
		g.leaderboardDirty = true
		g.scoresDirty = true
	}
}

func (g *Game) buildLeaderboard() []LeaderboardEntry {
	if !g.leaderboardDirty && g.cachedLeaderboard != nil {
		return g.cachedLeaderboard
	}
	scores := make(map[string]int, len(g.allTimeScores))
	for name, s := range g.allTimeScores {
		scores[name] = s
	}
	for _, p := range g.players {
		if p.Score > scores[p.Name] {
			scores[p.Name] = p.Score
		}
	}
	entries := make([]LeaderboardEntry, 0, len(scores))
	for name, score := range scores {
		entries = append(entries, LeaderboardEntry{Name: name, Score: score})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Score > entries[j].Score
	})
	if len(entries) > LeaderboardSize {
		entries = entries[:LeaderboardSize]
	}
	g.cachedLeaderboard = entries
	g.leaderboardDirty = false
	return entries
}

// ---- State serialisation ----

func (g *Game) buildStateMsg() StateMsg {
	players := make([]*Player, 0, len(g.players))
	for _, p := range g.players {
		cp := *p
		players = append(players, &cp)
	}

	enemies := make([]*Enemy, 0, len(g.enemies))
	for _, e := range g.enemies {
		if e.Alive {
			cp := *e
			enemies = append(enemies, &cp)
		}
	}

	bullets := make([]*Bullet, 0, len(g.bullets))
	for _, b := range g.bullets {
		cp := *b
		bullets = append(bullets, &cp)
	}

	shields := make([]*ShieldCell, 0, len(g.shields))
	for _, s := range g.shields {
		cp := *s
		shields = append(shields, &cp)
	}

	powerups := make([]*PowerUp, 0, len(g.powerups))
	for _, pu := range g.powerups {
		cp := *pu
		powerups = append(powerups, &cp)
	}

	var ufo *UFO
	if g.ufo != nil {
		cp := *g.ufo
		ufo = &cp
	}

	return StateMsg{
		Type: "state",
		State: GameState{
			Tick:        g.tick,
			Wave:        g.wave,
			Players:     players,
			Enemies:     enemies,
			Bullets:     bullets,
			Shields:     shields,
			PowerUps:    powerups,
			UFO:         ufo,
			UFOKill:     g.ufoKill,
			BombKill:    g.bombKill,
			Leaderboard: g.buildLeaderboard(),
			GameOver:    g.gameOver,
			EnemySpeed:  g.enemySpeed,
		},
	}
}
