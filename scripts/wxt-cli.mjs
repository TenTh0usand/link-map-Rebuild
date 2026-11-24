import { build, prepare, zip } from 'wxt';

const [, , command = 'build', browserArg = 'chrome'] = process.argv;

async function main() {
    switch (command) {
        case 'prepare':
            await prepare();
            break;
        case 'build':
            await build({ browser: browserArg });
            break;
        case 'zip':
            await zip({ browser: browserArg });
            break;
        default:
            console.error(`Unknown WXT command: ${command}`);
            process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
