package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"time"
)

type Weather struct {
	Location    string    `json:"location"`
	Temperature float64   `json:"temperature"`
	Unit        string    `json:"unit"`
	Humidity    int       `json:"humidity"`
	WindSpeed   float64   `json:"wind_speed"`
	WindDir     string    `json:"wind_direction"`
	Condition   string    `json:"condition"`
	Timestamp   time.Time `json:"timestamp"`
}

var conditions = []string{"Sunny", "Partly Cloudy", "Cloudy", "Rainy", "Stormy", "Snowy", "Foggy", "Windy"}
var directions = []string{"N", "NE", "E", "SE", "S", "SW", "W", "NW"}
var cities = []string{"New York", "London", "Tokyo", "Sydney", "Paris", "Berlin", "Toronto", "Mumbai"}

func generateWeather() Weather {
	return Weather{
		Location:    cities[rand.Intn(len(cities))],
		Temperature: float64(rand.Intn(45)-10) + rand.Float64(),
		Unit:        "celsius",
		Humidity:    rand.Intn(100),
		WindSpeed:   float64(rand.Intn(50)) + rand.Float64(),
		WindDir:     directions[rand.Intn(len(directions))],
		Condition:   conditions[rand.Intn(len(conditions))],
		Timestamp:   time.Now().UTC(),
	}
}

func weatherHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	weather := generateWeather()
	json.NewEncoder(w).Encode(weather)
}

func main() {
	rand.Seed(time.Now().UnixNano())
	http.HandleFunc("/", weatherHandler)
	fmt.Println("Weather server running on http://localhost:3000")
	http.ListenAndServe(":3000", nil)
}
