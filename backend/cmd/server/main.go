package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"niseva-rms/backend/internal/rms"
	"os"
	"os/signal"
	pathpkg "path"
	"strings"
	"syscall"
	"time"
)

//go:embed dist/*
var embedded embed.FS

func serveApplication(files http.Handler, ui fs.FS, w http.ResponseWriter, r *http.Request) {
	uiPath := strings.Trim(r.URL.Path, "/")
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) && uiPath != "" &&
		!strings.HasPrefix(uiPath, "assets/") && pathpkg.Ext(uiPath) == "" {
		if _, err := fs.Stat(ui, uiPath); err != nil {
			clone := r.Clone(r.Context())
			clone.URL.Path = "/"
			files.ServeHTTP(w, clone)
			return
		}
	}
	files.ServeHTTP(w, r)
}

func main() {
	mode := flag.String("mode", "core", "core, tunnel, migrate, init-ca, admin")
	hosts := flag.String("hosts", "", "comma-separated certificate DNS names/IPs, including tunnel wildcard")
	flag.Parse()
	c, e := rms.FromEnv()
	if e != nil {
		log.Fatal(e)
	}
	if *mode == "init-ca" {
		if *hosts == "" {
			log.Fatal("-hosts required")
		}
		if e = rms.InitPKI(c.PKIDir, strings.Split(*hosts, ",")); e != nil {
			log.Fatal(e)
		}
		return
	}
	if *mode == "migrate" || *mode == "admin" {
		d, e := rms.OpenDB(c.DatabaseURL)
		if e != nil {
			log.Fatal(e)
		}
		defer d.Close()
		if *mode == "migrate" {
			e = rms.Migrate(d)
		} else {
			e = rms.BootstrapAdmin(d, os.Getenv("RMS_ADMIN_EMAIL"), os.Getenv("RMS_ADMIN_PASSWORD"))
		}
		if e != nil {
			log.Fatal(e)
		}
		return
	}
	if *mode == "tunnel" {
		e = c.ValidateTunnel()
	} else {
		e = c.Validate()
	}
	if e != nil {
		log.Fatal(e)
	}
	ui, e := fs.Sub(embedded, "dist")
	if e != nil {
		log.Fatal(e)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	var h http.Handler
	if *mode == "core" {
		if len(os.Getenv("JWT_SECRET")) < 32 {
			log.Fatal("JWT_SECRET must contain at least 32 bytes")
		}
		d, e := rms.OpenDB(c.DatabaseURL)
		if e != nil {
			log.Fatal(e)
		}
		defer d.Close()
		if e = rms.CheckSchema(d); e != nil {
			log.Fatal(e)
		}
		if e = rms.Partitions(d, time.Now()); e != nil {
			log.Fatal(e)
		}
		ca, e := rms.LoadAuthority(c.PKIDir)
		if e != nil {
			log.Fatal(e)
		}
		core := &rms.Core{DB: d, Config: c, CA: ca}
		if _, e = core.StartMQTT(ctx); e != nil {
			log.Fatal(e)
		}
		go core.Maintain(ctx)
		api := core.Handler()
		files := http.FileServer(http.FS(ui))
		h = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/internal/") || r.URL.Path == "/health" {
				api.ServeHTTP(w, r)
				return
			}
			serveApplication(files, ui, w, r)
		})
	} else if *mode == "tunnel" {
		g, e := rms.NewGateway(c, ui)
		if e != nil {
			log.Fatal(e)
		}
		if e = g.Reconcile(); e != nil {
			log.Fatal(e)
		}
		defer g.Shutdown()
		h = g.Handler()
	} else {
		log.Fatal("unknown mode")
	}
	tc, e := rms.TLSConfig(c.PKIDir, "server", true)
	if e != nil {
		log.Fatal(e)
	}
	server := &http.Server{Addr: c.Listen, Handler: h, TLSConfig: tc, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	if *mode == "tunnel" {
		rms.ConfigureTunnelTLS(tc, c.TunnelDomain)
	}
	go func() {
		<-ctx.Done()
		deadline, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		server.Shutdown(deadline)
	}()
	log.Printf("rms %s listening with TLS on %s", *mode, c.Listen)
	if e = server.ListenAndServeTLS("", ""); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
