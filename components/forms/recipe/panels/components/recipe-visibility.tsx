'use client'

import { MyInfoIcon } from "@/components/popovers/infoPopover";
import { Popover, Switch, rem } from "@mantine/core";
import { MdOutlinePublic } from "react-icons/md";
import { RiGitRepositoryPrivateLine } from "react-icons/ri";

export default function RecipeVisibility({ secret, handleSecret, width }: { secret: boolean, handleSecret: (value: boolean) => void, width: number }) {
    return (
        <div className={`flex flex-row justify-start items-center ${width > 640 ? 'w-1/2' : 'w-content'} h-content p-2 space-x-2 mb-4`}>
            <Popover width={'auto'} position='top-start' withArrow shadow-sm="md">
                <Popover.Target>
                    <div className="w-content">
                        <MyInfoIcon title="" />
                    </div>
                </Popover.Target>
                <Popover.Dropdown styles={{ dropdown: { backgroundColor: 'GrayText', color: 'white' } }} w={width / 2}>
                    <p className="pb-2 underline font-semibold">{`If this is set to: `}</p>
                    <ul className="list-disc pl-4">
                        <li key={'public'} className="pb-2"><span className="italic">Public: </span>{`Recipes are set to public by default. Anyone can view them if they look through the public recipes in your profile. They will not be posted anywhere else without your say so. Public recipes may be added to your Family or Communities later.`}</li>
                        <li key={'private'} className="pb-2"><span className="italic">Private: </span>{`Only you and the viewers you choose can see a private recipe. If you share it with your family, connected family members can also view it while it remains in the family collection. Removing it from the family collection revokes that family access; individually named viewers keep their access. Private recipes may not be added to Communities.`}</li>
                    </ul>
                </Popover.Dropdown>
            </Popover>
            <Switch
                label='Recipe Visibility'
                style={{ cursor: 'pointer' }}
                checked={secret}
                onChange={(e) => {
                    handleSecret(e.currentTarget.checked);
                }}
                color="red"
                size="md"
                onLabel='Private'
                offLabel='Public'
                thumbIcon={
                    !secret ? (
                        <MdOutlinePublic
                            style={{ width: rem(12), height: rem(12) }}
                            color={'teal'}
                        />
                    ) : (
                        <RiGitRepositoryPrivateLine
                            style={{ width: rem(12), height: rem(12) }}
                            color={'red'}
                        />
                    )
                }
            />
        </div>
    )
}
