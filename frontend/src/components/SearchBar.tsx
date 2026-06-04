interface SearchBarProps {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
}

export const SearchBar = ({ searchTerm, setSearchTerm }: SearchBarProps) => {
    return (
        <div className="mb-6">
            <input
                type="text"
                placeholder="Buscar insumo por nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full md:w-1/2 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            />
        </div>
    );
};