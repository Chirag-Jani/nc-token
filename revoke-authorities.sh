#!/bin/bash

# Script to revoke both mint authority and update authority
# Usage: ./revoke-authorities.sh [MINT_ADDRESS] [STATE_PDA] [METADATA_ADDRESS]

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if deployment-info.json exists
DEPLOYMENT_INFO="deployment-info.json"

if [ -f "$DEPLOYMENT_INFO" ]; then
    print_info "Found deployment-info.json, loading configuration..."
    
    # Try to use jq if available, otherwise use grep/sed as fallback, or node
    if command -v jq &> /dev/null; then
        MINT_ADDRESS=$(jq -r '.mint // empty' "$DEPLOYMENT_INFO" 2>/dev/null || echo "")
        STATE_PDA=$(jq -r '.statePda // empty' "$DEPLOYMENT_INFO" 2>/dev/null || echo "")
        METADATA_ADDRESS=$(jq -r '.metadata // empty' "$DEPLOYMENT_INFO" 2>/dev/null || echo "")
        NETWORK=$(jq -r '.network // "https://api.devnet.solana.com"' "$DEPLOYMENT_INFO" 2>/dev/null || echo "https://api.devnet.solana.com")
    elif command -v node &> /dev/null; then
        # Use node to parse JSON (more reliable than grep/sed)
        MINT_ADDRESS=$(node -e "try { const d = require('./$DEPLOYMENT_INFO'); console.log(d.mint || ''); } catch(e) { console.log(''); }" 2>/dev/null || echo "")
        STATE_PDA=$(node -e "try { const d = require('./$DEPLOYMENT_INFO'); console.log(d.statePda || ''); } catch(e) { console.log(''); }" 2>/dev/null || echo "")
        METADATA_ADDRESS=$(node -e "try { const d = require('./$DEPLOYMENT_INFO'); console.log(d.metadata || ''); } catch(e) { console.log(''); }" 2>/dev/null || echo "")
        NETWORK=$(node -e "try { const d = require('./$DEPLOYMENT_INFO'); console.log(d.network || 'https://api.devnet.solana.com'); } catch(e) { console.log('https://api.devnet.solana.com'); }" 2>/dev/null || echo "https://api.devnet.solana.com")
    else
        # Fallback: use grep and sed to parse JSON (basic parsing)
        MINT_ADDRESS=$(grep -o '"mint"[[:space:]]*:[[:space:]]*"[^"]*"' "$DEPLOYMENT_INFO" 2>/dev/null | sed 's/.*"mint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
        STATE_PDA=$(grep -o '"statePda"[[:space:]]*:[[:space:]]*"[^"]*"' "$DEPLOYMENT_INFO" 2>/dev/null | sed 's/.*"statePda"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
        METADATA_ADDRESS=$(grep -o '"metadata"[[:space:]]*:[[:space:]]*"[^"]*"' "$DEPLOYMENT_INFO" 2>/dev/null | sed 's/.*"metadata"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
        NETWORK=$(grep -o '"network"[[:space:]]*:[[:space:]]*"[^"]*"' "$DEPLOYMENT_INFO" 2>/dev/null | sed 's/.*"network"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "https://api.devnet.solana.com")
    fi
else
    print_warning "deployment-info.json not found, using command line arguments, environment variables, or TypeScript defaults"
fi

# Override with command line arguments if provided
if [ ! -z "$1" ]; then
    MINT_ADDRESS="$1"
fi

if [ ! -z "$2" ]; then
    STATE_PDA="$2"
fi

if [ ! -z "$3" ]; then
    METADATA_ADDRESS="$3"
fi

# Override with environment variables if set
MINT_ADDRESS="${MINT_ADDRESS:-${MINT_ADDRESS_ENV}}"
STATE_PDA="${STATE_PDA:-${STATE_PDA_ENV}}"
METADATA_ADDRESS="${METADATA_ADDRESS:-${METADATA_ADDRESS_ENV}}"
NETWORK="${NETWORK:-${NETWORK_ENV:-https://api.devnet.solana.com}}"

# Validate inputs - warn if empty but don't exit (TypeScript has defaults)
# The TypeScript script will handle validation and use defaults if needed
if [ -z "$MINT_ADDRESS" ] && [ -z "$STATE_PDA" ]; then
    print_info "No addresses provided via command line or deployment-info.json"
    print_info "TypeScript script will use hardcoded defaults from revoke-authorities.ts"
    echo ""
fi

# Check if required tools are installed
print_info "Checking prerequisites..."

if ! command -v anchor &> /dev/null; then
    print_error "Anchor CLI is not installed or not in PATH"
    echo "  Install from: https://www.anchor-lang.com/docs/installation"
    exit 1
fi

if ! command -v yarn &> /dev/null; then
    print_error "Yarn is not installed or not in PATH"
    echo "  Install from: https://yarnpkg.com/getting-started/install"
    exit 1
fi

if ! command -v ts-node &> /dev/null && ! yarn list --depth=0 2>/dev/null | grep -q "ts-node"; then
    print_warning "ts-node not found, installing..."
    yarn add -D ts-node
fi

print_success "Prerequisites check passed"

# Check if program is built
if [ ! -f "target/idl/spl_project.json" ]; then
    print_warning "IDL not found, building program..."
    anchor build
    if [ $? -ne 0 ]; then
        print_error "Failed to build program"
        exit 1
    fi
    print_success "Program built successfully"
fi

# Export variables for the TypeScript script
export MINT_ADDRESS
export STATE_PDA
export METADATA_ADDRESS
export NETWORK

# Run the TypeScript script
print_info "Running revoke-authorities script..."
echo ""

yarn ts-node scripts/revoke-authorities.ts

if [ $? -eq 0 ]; then
    echo ""
    print_success "Script completed successfully!"
    echo ""
    print_info "To verify the authorities were revoked, run:"
    echo "  spl-token display $MINT_ADDRESS --url $NETWORK"
    echo ""
    print_info "Or check the mint account:"
    echo "  solana account $MINT_ADDRESS --url $NETWORK"
else
    print_error "Script failed"
    exit 1
fi

