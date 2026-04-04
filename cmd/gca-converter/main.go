package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/AntTheLimey/gm-apprentice/internal/converter"
)

func main() {
	input := flag.String("input", "",
		"Path to GCA4 data files directory")
	output := flag.String("output", "",
		"Output directory for converted markdown")
	flag.Parse()

	if *input == "" || *output == "" {
		fmt.Fprintln(os.Stderr,
			"Usage: gca-converter --input <path> --output <path>")
		fmt.Fprintln(os.Stderr,
			"  --input   Path to GCA4 data files directory")
		fmt.Fprintln(os.Stderr,
			"  --output  Output directory for markdown files")
		os.Exit(1)
	}

	// Expand ~ in output path
	expandedOutput := expandHome(*output)

	// Find all .gdf files
	entries, err := os.ReadDir(*input)
	if err != nil {
		fmt.Fprintf(os.Stderr,
			"Error reading input directory: %v\n", err)
		os.Exit(1)
	}

	converted := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(
			strings.ToLower(entry.Name()), ".gdf") {
			continue
		}

		gdfPath := filepath.Join(*input, entry.Name())
		fmt.Printf("Converting: %s\n", entry.Name())

		if err := converter.ConvertFile(
			gdfPath, expandedOutput); err != nil {
			fmt.Fprintf(os.Stderr,
				"  Error: %v\n", err)
			continue
		}
		converted++
	}

	fmt.Printf("\nDone. Converted %d books to %s\n",
		converted, expandedOutput)
}

func expandHome(path string) string {
	if strings.HasPrefix(path, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[1:])
	}
	return path
}
